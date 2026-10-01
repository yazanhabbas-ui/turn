"use client";

import { Copy, MapPinned, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import type { City, L } from "../types";
import { CityCoverage } from "../coverage/coverage";
import { LOOKUPS, useLookups, useText } from "../use-lookups";

const CITIES = "/api/v1/admin/cities";
const OVERRIDES = `${CITIES}/overrides`;

type Overview = { cityId: string; overrides: string[]; branchOverrides: number; hiddenReasons: number };

export function CitiesPage() {
  const t = useTranslations("cities");
  const text = useText();
  const lookups = useLookups();
  const [editing, setEditing] = useState<City | "new" | null>(null);
  const cities = lookups.data?.cities;
  const overview = useApiQuery<{ items: Overview[] }>(OVERRIDES);

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
                  <CityCoverage cityId={c.id} />
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(c)}>
                  <Pencil aria-hidden />
                </Button>
              </div>
              <ConfigOverview
                city={c}
                others={cities.filter((o) => o.id !== c.id)}
                data={overview.data?.items.find((o) => o.cityId === c.id)}
              />
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

/** What a city overrides (D60), a link to its settings, and "copy configuration from another city". */
function ConfigOverview({ city, others, data }: { city: City; others: City[]; data: Overview | undefined }) {
  const t = useTranslations("cities.config");
  const text = useText();
  const [from, setFrom] = useState("");
  const copy = useApiMutation(() => api(`${CITIES}/${city.id}/copy-config`, { body: { fromCityId: from } }), {
    invalidate: [[OVERRIDES], ["/api/v1/admin/settings"]],
    success: t("copied"),
    onSuccess: () => setFrom(""),
  });
  const count = data?.overrides.length ?? 0;
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <SlidersHorizontal className="text-muted-foreground size-4" aria-hidden />
        <span className="font-medium">{t("title")}</span>
        <Badge variant={count ? "default" : "outline"}>{t("overridden", { count })}</Badge>
        {!!data?.branchOverrides && <Badge variant="outline">{t("branchOverrides", { count: data.branchOverrides })}</Badge>}
        {!!data?.hiddenReasons && <Badge variant="outline">{t("hiddenReasons", { count: data.hiddenReasons })}</Badge>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={{ pathname: "/admin/settings", query: { scope: `city:${city.id}` } }} />}
        >
          {t("open")}
        </Button>
        {others.length > 0 && (
          <>
            <NativeSelect aria-label={t("copyFrom")} className="h-8 w-44" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{t("copyFrom")}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {text(o.name)}
                </option>
              ))}
            </NativeSelect>
            {from && (
              <ConfirmButton
                label={t("copy")}
                icon={<Copy aria-hidden />}
                title={t("copyTitle", { from: text(others.find((o) => o.id === from)?.name), to: text(city.name) })}
                description={t("copyBody")}
                confirmLabel={t("copy")}
                onConfirm={() => copy.mutateAsync(undefined)}
              />
            )}
          </>
        )}
      </div>
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
