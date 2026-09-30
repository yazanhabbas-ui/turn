"use client";

import { MapPinned, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { City, L } from "../types";
import { LOOKUPS, useLookups, useText } from "../use-lookups";

const CITIES = "/api/v1/admin/cities";

export function CitiesPage() {
  const t = useTranslations("cities");
  const text = useText();
  const lookups = useLookups();
  const [editing, setEditing] = useState<City | "new" | null>(null);
  const cities = lookups.data?.cities;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        }
      />
      {lookups.isLoading ? (
        <LoadingRows />
      ) : lookups.isError || !cities ? (
        <ErrorState onRetry={() => lookups.refetch()} />
      ) : cities.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cities.map((c) => (
            <div key={c.id} className="bg-card rounded-xl border p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
                  <MapPinned className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{text(c.name)}</h2>
                    <Badge variant="outline" dir="ltr">
                      {c.code}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">{t("branchesCount", { count: c.branchCount })}</p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(c)}>
                  <Pencil aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CityDialog
        city={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function CityDialog({ city, open, onOpenChange }: { city: City | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("cities");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const [f, setF] = useState({ code: "", name: {} as L });

  useEffect(() => {
    if (open) setF({ code: city?.code ?? "", name: city?.name ?? {} });
  }, [open, city]);

  const invalidate = [[LOOKUPS], [CITIES]];
  const save = useApiMutation(() => (city ? api(`${CITIES}/${city.id}`, { method: "PUT", body: f }) : api(CITIES, { body: f })), {
    invalidate,
    success: tu("saved"),
    onSuccess: () => onOpenChange(false),
  });
  const archive = useApiMutation(() => api(`${CITIES}/${city!.id}`, { method: "DELETE" }), {
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{city ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="c-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <Field label={t("code")} htmlFor="c-code" hint={t("codeHint")}>
            <Input
              id="c-code"
              dir="ltr"
              required
              pattern="[A-Z0-9_\-]+"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            />
          </Field>
          <DialogFooter className="gap-2">
            {city && (
              <ConfirmButton
                variant="destructive"
                label={tu("archive")}
                title={t("archiveTitle")}
                description={t("archiveBody")}
                onConfirm={() => archive.mutateAsync(undefined)}
              />
            )}
            <span className="flex-1" />
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
