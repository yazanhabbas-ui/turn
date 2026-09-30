"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { L, BreakType } from "../../types";
import { LOOKUPS, useText } from "../../use-lookups";
import { Check } from "../setting-field";

export function BreaksSection({ items }: { items: BreakType[] }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [editing, setEditing] = useState<BreakType | "new" | null>(null);
  const [f, setF] = useState({ name: {} as L, maxMinutes: "" as string | number, countsAsProductive: false, sortOrder: 0 });
  useEffect(() => {
    if (editing === null) return;
    setF(
      editing === "new"
        ? { name: {}, maxMinutes: 15, countsAsProductive: false, sortOrder: items.length }
        : { ...editing, maxMinutes: editing.maxMinutes ?? "" },
    );
  }, [editing, items.length]);
  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { ...f, maxMinutes: f.maxMinutes === "" ? null : Number(f.maxMinutes) };
      return editing && editing !== "new"
        ? api(`/api/v1/admin/break-types/${editing.id}`, { method: "PUT", body })
        : api("/api/v1/admin/break-types", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => setEditing(null) },
  );
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/break-types/${id}`, { method: "DELETE" }), { invalidate });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addBreak")}
        </Button>
      </div>
      {items.length === 0 && <EmptyState title={t("ui.breaksEmpty")} />}
      {items.map((b) => (
        <div key={b.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
          <div className="flex-1">
            <div className="font-medium">{text(b.name)}</div>
            <div className="text-muted-foreground text-xs">
              {b.maxMinutes ? `${t("maxMinutes")}: ${b.maxMinutes}` : "—"}
              {b.countsAsProductive && ` · ${t("productive")}`}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="max-lg:size-10" aria-label={tu("edit")} onClick={() => setEditing(b)}>
            <Pencil aria-hidden />
          </Button>
          <ConfirmButton
            size="icon-sm"
            variant="ghost"
            icon={<Trash2 aria-hidden />}
            label={tu("archive")}
            title={tu("confirmArchive")}
            description={tu("confirmArchiveBody")}
            onConfirm={() => archive.mutateAsync(b.id)}
          />
        </div>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("tabs.breaks")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <LocalizedInput id="bt-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
            <Field label={t("maxMinutes")} htmlFor="bt-max" className="max-w-40">
              <Input
                id="bt-max"
                type="number"
                min={1}
                max={480}
                value={f.maxMinutes}
                onChange={(e) => setF({ ...f, maxMinutes: e.target.value })}
              />
            </Field>
            <Check
              label={t("productive")}
              checked={f.countsAsProductive}
              onChange={(countsAsProductive) => setF({ ...f, countsAsProductive })}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {tu("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
