"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Check } from "./check";
import type { AudioPack, Lang } from "./types";

const PACKS = "/api/v1/admin/audio-packs";

export function AudioPacks() {
  const t = useTranslations("screens.voice");
  const tu = useTranslations("ui");
  const list = useApiQuery<{ items: AudioPack[] }>(PACKS);
  const [editing, setEditing] = useState<AudioPack | "new" | null>(null);
  const remove = useApiMutation((id: string) => api(`${PACKS}/${id}`, { method: "DELETE" }), { invalidate: [[PACKS]] });

  if (list.isLoading) return <LoadingRows rows={2} />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;

  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-muted-foreground text-sm">{t("packsHint")}</p>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addPack")}
        </Button>
      </div>
      {list.data.items.length === 0 ? (
        <EmptyState title={t("packsEmpty")} />
      ) : (
        list.data.items.map((p) => (
          <div key={p.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {p.name}
                <Badge variant="secondary">{p.locale === "ar" ? t("langAr") : t("langEn")}</Badge>
                <Badge variant={p.isActive ? "default" : "outline"}>{p.isActive ? tu("active") : tu("inactive")}</Badge>
              </div>
              <div className="text-muted-foreground text-xs">{t("clips", { count: p.clips })}</div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(p)}>
              <Pencil aria-hidden />
            </Button>
            <ConfirmButton
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              label={tu("delete")}
              title={tu("confirmDelete")}
              description={tu("confirmDeleteBody")}
              onConfirm={() => remove.mutateAsync(p.id)}
            />
          </div>
        ))
      )}
      <PackDialog
        pack={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function parseManifest(
  raw: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: "json" | "shape" | "value" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "shape" };
  for (const v of Object.values(parsed)) {
    if (typeof v !== "string" || !(v.startsWith("/") || v.startsWith("data:audio/"))) return { ok: false, error: "value" };
  }
  return { ok: true, value: parsed as Record<string, string> };
}

function PackDialog({ pack, open, onOpenChange }: { pack: AudioPack | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("screens.voice");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const [f, setF] = useState({ locale: "ar" as Lang, name: "", manifest: "{}", isActive: true });

  useEffect(() => {
    if (open)
      setF({
        locale: pack?.locale ?? "ar",
        name: pack?.name ?? "",
        manifest: JSON.stringify(pack?.manifest ?? {}, null, 2),
        isActive: pack?.isActive ?? true,
      });
  }, [open, pack]);

  const parsed = parseManifest(f.manifest);
  const save = useApiMutation(
    () => {
      if (!parsed.ok) throw new Error("manifest");
      const body = { locale: f.locale, name: f.name.trim(), manifest: parsed.value, isActive: f.isActive };
      return pack ? api(`${PACKS}/${pack.id}`, { method: "PUT", body }) : api(PACKS, { body });
    },
    { invalidate: [[PACKS]], success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pack ? t("editPack") : t("addPack")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.ok) save.mutate(undefined);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tu("name")} htmlFor="ap-name">
              <Input id="ap-name" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={tu("language")} htmlFor="ap-locale">
              <NativeSelect id="ap-locale" value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as Lang })}>
                <option value="ar">{t("langAr")}</option>
                <option value="en">{t("langEn")}</option>
              </NativeSelect>
            </Field>
          </div>
          <Field
            label={t("manifest")}
            htmlFor="ap-manifest"
            hint={t("manifestHelp", { example: `"${f.locale}.phrase.number": "/audio/${f.locale}/number.mp3"` })}
            error={parsed.ok ? null : t(`manifestErrors.${parsed.error}`)}
          >
            <Textarea
              id="ap-manifest"
              dir="ltr"
              rows={12}
              spellCheck={false}
              className="font-mono text-xs"
              value={f.manifest}
              onChange={(e) => setF({ ...f, manifest: e.target.value })}
            />
          </Field>
          <Check label={tu("active")} checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !parsed.ok}>
              {tu("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
