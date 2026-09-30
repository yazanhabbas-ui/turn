"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { L, Shift } from "../types";
import { LOOKUPS, useText } from "../use-lookups";

/** Organization-wide shifts (when agents work): list, add, edit, archive. */
export function ShiftsManager({ items }: { items: Shift[] }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const [f, setF] = useState({ code: "", name: {} as L, startsAt: "08:00", endsAt: "15:00", sortOrder: 0 });
  useEffect(() => {
    if (editing === null) return;
    setF(
      editing === "new"
        ? { code: "", name: {}, startsAt: "08:00", endsAt: "15:00", sortOrder: items.length }
        : {
            code: editing.code,
            name: editing.name,
            startsAt: editing.startsAt,
            endsAt: editing.endsAt,
            sortOrder: editing.sortOrder,
          },
    );
  }, [editing, items.length]);
  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () =>
      editing && editing !== "new"
        ? api(`/api/v1/admin/shifts/${editing.id}`, { method: "PUT", body: f })
        : api("/api/v1/admin/shifts", { body: f }),
    { invalidate, success: tu("saved"), onSuccess: () => setEditing(null) },
  );
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/shifts/${id}`, { method: "DELETE" }), { invalidate });
  const overnight = f.endsAt <= f.startsAt;

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("shifts")}</h3>
          <p className="text-muted-foreground text-xs">{t("shiftsHint")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addShift")}
        </Button>
      </div>
      {items.length === 0 && <p className="text-muted-foreground text-sm">{t("shiftsEmpty")}</p>}
      {items.map((sh) => (
        <div key={sh.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 font-medium">
              {text(sh.name)}
              <Badge variant="secondary">
                <span dir="ltr">{sh.code}</span>
              </Badge>
            </div>
            <div className="text-muted-foreground text-xs">
              <bdi className="tabular">
                {sh.startsAt}–{sh.endsAt}
              </bdi>
              {sh.endsAt <= sh.startsAt && ` · ${t("shiftOvernight")}`}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(sh)}>
            <Pencil aria-hidden />
          </Button>
          <ConfirmButton
            size="icon-sm"
            variant="ghost"
            icon={<Trash2 aria-hidden />}
            label={tu("archive")}
            title={tu("confirmArchive")}
            description={tu("confirmArchiveBody")}
            onConfirm={() => archive.mutateAsync(sh.id)}
          />
        </div>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("addShift") : t("editShift")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <LocalizedInput id="sh-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
            <Field label={t("shiftCode")} htmlFor="sh-code" hint={t("shiftCodeHint")} className="max-w-56">
              <Input
                id="sh-code"
                dir="ltr"
                required
                maxLength={20}
                pattern="[A-Z0-9_\-]+"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("shiftStarts")} htmlFor="sh-start">
                <Input
                  id="sh-start"
                  type="time"
                  dir="ltr"
                  required
                  value={f.startsAt}
                  onChange={(e) => setF({ ...f, startsAt: e.target.value })}
                />
              </Field>
              <Field label={t("shiftEnds")} htmlFor="sh-end">
                <Input
                  id="sh-end"
                  type="time"
                  dir="ltr"
                  required
                  value={f.endsAt}
                  onChange={(e) => setF({ ...f, endsAt: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-muted-foreground text-xs">{overnight ? t("shiftOvernightNote") : t("shiftEndsHint")}</p>
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
