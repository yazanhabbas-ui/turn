"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { ENTITY_ICON_KEYS, EntityIcon } from "@/components/app/entity-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { L, Priority } from "../../types";
import { LOOKUPS, useText } from "../../use-lookups";
import { Check } from "../setting-field";

export function PrioritiesSection({ items }: { items: Priority[] }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [editing, setEditing] = useState<Priority | "new" | null>(null);
  const [f, setF] = useState({
    key: "",
    name: {} as L,
    weight: 0,
    isLane: false,
    color: "#64748b",
    icon: "" as string,
    sortOrder: 0,
  });
  useEffect(() => {
    if (editing === null) return;
    setF(
      editing === "new"
        ? { key: "", name: {}, weight: 50, isLane: false, color: "#0369a1", icon: "", sortOrder: items.length }
        : { ...editing, icon: editing.icon ?? "" },
    );
  }, [editing, items.length]);
  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { ...f, icon: f.icon || null };
      return editing && editing !== "new"
        ? api(`/api/v1/admin/priority-levels/${editing.id}`, { method: "PUT", body })
        : api("/api/v1/admin/priority-levels", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => setEditing(null) },
  );
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/priority-levels/${id}`, { method: "DELETE" }), {
    invalidate,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addPriority")}
        </Button>
      </div>
      {items.length === 0 && <EmptyState title={t("ui.prioritiesEmpty")} />}
      {items.map((p) => (
        <div key={p.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
          <span className="grid size-9 place-items-center rounded-lg text-white" style={{ backgroundColor: p.color }}>
            <EntityIcon name={p.icon} className="size-4.5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2 font-medium">
              {text(p.name)}
              {p.isLane && <Badge variant="secondary">{t("isLane")}</Badge>}
            </div>
            <div className="text-muted-foreground text-xs">
              <span dir="ltr">{p.key}</span> · {t("priorityWeight")}: <span className="tabular">{p.weight}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="max-lg:size-10" aria-label={tu("edit")} onClick={() => setEditing(p)}>
            <Pencil aria-hidden />
          </Button>
          {p.key !== "normal" && (
            <ConfirmButton
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              label={tu("archive")}
              title={tu("confirmArchive")}
              description={tu("confirmArchiveBody")}
              onConfirm={() => archive.mutateAsync(p.id)}
            />
          )}
        </div>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("tabs.priorities")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <LocalizedInput id="pr-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("priorityKey")} htmlFor="pr-key">
                <Input
                  id="pr-key"
                  dir="ltr"
                  required
                  pattern="[a-z][a-z0-9_]*"
                  value={f.key}
                  onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })}
                />
              </Field>
              <Field label={t("priorityWeight")} htmlFor="pr-w" hint={t("priorityWeightHint")}>
                <Input
                  id="pr-w"
                  type="number"
                  min={0}
                  max={1000}
                  value={f.weight}
                  onChange={(e) => setF({ ...f, weight: Number(e.target.value) })}
                />
              </Field>
              <Field label={tu("color")} htmlFor="pr-c">
                <Input
                  id="pr-c"
                  type="color"
                  className="h-9 p-1"
                  value={f.color}
                  onChange={(e) => setF({ ...f, color: e.target.value })}
                />
              </Field>
            </div>
            <Check label={t("isLane")} hint={t("isLaneHint")} checked={f.isLane} onChange={(isLane) => setF({ ...f, isLane })} />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tu("icon")}>
              {ENTITY_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.icon === k}
                  aria-label={k}
                  onClick={() => setF({ ...f, icon: k })}
                  className={`grid size-8 place-items-center rounded-md border ${f.icon === k ? "border-brand bg-brand/10 text-brand" : "hover:bg-muted"}`}
                >
                  <EntityIcon name={k} className="size-4" />
                </button>
              ))}
            </div>
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
