"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Branch, L } from "../types";
import { useText } from "../use-lookups";
import { Check } from "./check";
import type { Announcement } from "./types";

const ANNOUNCEMENTS = "/api/v1/admin/announcements";
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/** ISO string → value for <input type="datetime-local"> in the browser's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

type Form = {
  kind: "ticker" | "slide";
  body: L;
  mediaUrl: string;
  durationSeconds: number;
  branchId: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  isActive: boolean;
};

function toForm(a: Announcement | null, count: number): Form {
  return {
    kind: a?.kind ?? "ticker",
    body: a?.body ?? {},
    mediaUrl: a?.mediaUrl ?? "",
    durationSeconds: a?.durationSeconds ?? 10,
    branchId: a?.branchId ?? "",
    startsAt: toLocalInput(a?.startsAt ?? null),
    endsAt: toLocalInput(a?.endsAt ?? null),
    sortOrder: a?.sortOrder ?? count,
    isActive: a?.isActive ?? true,
  };
}

export function AnnouncementDialog({
  branches,
  item,
  count,
  open,
  onOpenChange,
}: {
  branches: Branch[];
  item: Announcement | null;
  count: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("screens");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [f, setF] = useState<Form>(() => toForm(null, 0));
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setF(toForm(item, count));
      setImageError(null);
    }
  }, [open, item, count]);

  const save = useApiMutation(
    () => {
      const body = {
        kind: f.kind,
        body: f.body,
        mediaUrl: f.kind === "slide" && f.mediaUrl ? f.mediaUrl : undefined,
        durationSeconds: f.durationSeconds,
        branchId: f.branchId || undefined,
        startsAt: fromLocalInput(f.startsAt),
        endsAt: fromLocalInput(f.endsAt),
        sortOrder: f.sortOrder,
        isActive: f.isActive,
      };
      return item ? api(`${ANNOUNCEMENTS}/${item.id}`, { method: "PUT", body }) : api(ANNOUNCEMENTS, { body });
    },
    { invalidate: [[ANNOUNCEMENTS]], success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );

  function onFile(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImageError(t("ann.imageType"));
    if (file.size > MAX_IMAGE_BYTES) return setImageError(t("ann.imageTooBig"));
    const reader = new FileReader();
    reader.onload = () => setF((x) => ({ ...x, mediaUrl: String(reader.result) }));
    reader.onerror = () => setImageError(t("ann.imageType"));
    reader.readAsDataURL(file);
  }

  const isData = f.mediaUrl.startsWith("data:");
  const mediaInvalid = f.mediaUrl !== "" && !isData && !f.mediaUrl.startsWith("/");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? t("ann.edit") : t("ann.add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (mediaInvalid) return;
            save.mutate(undefined);
          }}
        >
          <Field label={t("ann.kind")} htmlFor="an-kind">
            <NativeSelect id="an-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Form["kind"] })}>
              <option value="ticker">{t("ann.kinds.ticker")}</option>
              <option value="slide">{t("ann.kinds.slide")}</option>
            </NativeSelect>
          </Field>
          <LocalizedInput
            id="an-body"
            label={t("ann.body")}
            multiline
            required
            maxLength={500}
            value={f.body}
            onChange={(body) => setF({ ...f, body })}
          />
          {f.kind === "slide" && (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-medium">{t("ann.image")}</legend>
                {f.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.mediaUrl} alt="" className="max-h-32 rounded-md border" />
                )}
                <Input type="file" accept="image/*" aria-label={t("ann.image")} onChange={(e) => onFile(e.target.files?.[0])} />
                <Field
                  label={t("ann.imagePath")}
                  htmlFor="an-media"
                  hint={t("ann.imageHint")}
                  error={imageError ?? (mediaInvalid ? t("ann.imagePathInvalid") : null)}
                >
                  <Input
                    id="an-media"
                    dir="ltr"
                    placeholder="/slides/welcome.jpg"
                    value={isData ? "" : f.mediaUrl}
                    onChange={(e) => setF({ ...f, mediaUrl: e.target.value.trim() })}
                  />
                </Field>
                {f.mediaUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, mediaUrl: "" })}>
                    {t("ann.removeImage")}
                  </Button>
                )}
              </fieldset>
              <Field label={t("ann.duration")} htmlFor="an-dur" className="max-w-40">
                <Input
                  id="an-dur"
                  type="number"
                  min={3}
                  max={120}
                  value={f.durationSeconds}
                  onChange={(e) => setF({ ...f, durationSeconds: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tu("branch")} htmlFor="an-branch">
              <NativeSelect id="an-branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                <option value="">{tu("allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={tu("sortOrder")} htmlFor="an-sort">
              <Input
                id="an-sort"
                type="number"
                min={0}
                value={f.sortOrder}
                onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("ann.startsAt")} htmlFor="an-start" hint={t("ann.optional")}>
              <Input
                id="an-start"
                type="datetime-local"
                dir="ltr"
                value={f.startsAt}
                onChange={(e) => setF({ ...f, startsAt: e.target.value })}
              />
            </Field>
            <Field label={t("ann.endsAt")} htmlFor="an-end" hint={t("ann.optional")}>
              <Input
                id="an-end"
                type="datetime-local"
                dir="ltr"
                value={f.endsAt}
                onChange={(e) => setF({ ...f, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <Check label={tu("active")} checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tu("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
