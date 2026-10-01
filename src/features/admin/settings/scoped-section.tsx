"use client";

import { CornerDownRight, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { LoadingRows } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { Branch, City } from "../types";
import { useText } from "../use-lookups";
import type { SectionDef } from "./sections/registry";
import type { AllSettings } from "./sections/types";
import { scopeQuery, type SettingsScope } from "./settings-context";
import { SETTINGS } from "./setting-form";

/** What the API says about one setting at the selected scope (GET /api/v1/admin/settings/sources). */
export type SourceInfo = {
  source: { level: "organization" | "city" | "branch"; cityId: string | null; branchId: string | null };
  own: boolean;
  overridable: boolean;
};
export type Sources = Record<string, SourceInfo>;

const RANK = { organization: 0, city: 1, branch: 2 } as const;

/** Label of the level a value comes from: "Organization default", "City: Damascus" or "Branch: Main". */
export function useSourceLabel(cities: City[], branches: Branch[]) {
  const t = useTranslations("settings.scope");
  const text = useText();
  return (info: SourceInfo["source"]) =>
    info.level === "branch"
      ? t("sourceBranch", { name: text(branches.find((b) => b.id === info.branchId)?.name) })
      : info.level === "city"
        ? t("sourceCity", { name: text(cities.find((c) => c.id === info.cityId)?.name) })
        : t("sourceOrganization");
}

/**
 * Wraps one settings section when a city or branch is selected: shows where the effective value comes from, lets
 * the user override it (copy-on-write: the override starts as the current value) or go back to the inherited one,
 * and disables sections that are only set organization-wide. In the organization scope it renders the section as is.
 */
export function ScopedSection({
  section,
  scope,
  sources,
  values,
  cities,
  branches,
  children,
}: {
  section: SectionDef;
  scope: SettingsScope;
  sources: Sources | undefined;
  values: AllSettings;
  cities: City[];
  branches: Branch[];
  children: React.ReactNode;
}) {
  const t = useTranslations("settings.scope");
  const [asking, setAsking] = useState(false);
  const label = useSourceLabel(cities, branches);
  const query = scopeQuery(scope);
  const level = scope.kind === "branch" ? t("levelBranch") : t("levelCity");
  const refresh = [[SETTINGS], [`${SETTINGS}${query}`], [`${SETTINGS}/sources${query}`], ["/api/v1/admin/wait-analytics"]];

  const override = useApiMutation(
    async () => {
      for (const k of section.keys) await api(`${SETTINGS}/${k}${query}`, { method: "PUT", body: values[k] });
    },
    { invalidate: refresh, success: t("overrideCreated") },
  );
  const reset = useApiMutation(
    async () => {
      for (const k of section.keys) if (sources?.[k]?.own) await api(`${SETTINGS}/${k}${query}`, { method: "DELETE" });
    },
    { invalidate: refresh, success: t("overrideRemoved") },
  );

  if (scope.kind === "organization") return <>{children}</>;
  if (!sources) return <LoadingRows rows={3} />;

  const infos = section.keys.map((k) => sources[k]).filter((i): i is SourceInfo => !!i);
  const overridable = infos.length > 0 && infos.length === section.keys.length && infos.every((i) => i.overridable);

  if (!overridable) {
    const cityOnly = scope.kind === "branch" && section.scope === "city";
    return (
      <div className="space-y-4">
        <div
          className="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm"
          role="note"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {cityOnly ? t("cityOnly") : t("organizationOnly")}
        </div>
        <fieldset disabled className="min-w-0 space-y-4 opacity-60">
          {children}
        </fieldset>
      </div>
    );
  }

  const own = infos.some((i) => i.own);
  const effective = infos.reduce((a, i) => (RANK[i.source.level] > RANK[a.source.level] ? i : a), infos[0]!);
  const busy = override.isPending || reset.isPending;
  const toggleLabel = scope.kind === "branch" ? t("overrideBranch") : t("overrideCity");

  return (
    <div className="space-y-4">
      <div className="bg-card flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border p-3 shadow-sm md:p-4">
        <label className="flex min-h-9 flex-1 basis-60 items-start gap-3 text-sm">
          <Switch
            checked={own}
            disabled={busy}
            aria-label={toggleLabel}
            onCheckedChange={(on) => {
              if (on) override.mutate(undefined);
              else setAsking(true);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">{toggleLabel}</span>
            <span className="text-muted-foreground block text-xs">
              {own ? t("overrideOnHint", { level }) : t("overrideOffHint", { source: label(effective.source) })}
            </span>
          </span>
        </label>
        <Badge variant={own ? "default" : "outline"} className="gap-1">
          <CornerDownRight className="size-3 rtl:-scale-x-100" aria-hidden />
          {label(
            own
              ? {
                  level: scope.kind,
                  cityId: scope.kind === "city" ? scope.id : effective.source.cityId,
                  branchId: scope.kind === "branch" ? scope.id : null,
                }
              : effective.source,
          )}
        </Badge>
        {own && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setAsking(true)}>
            {t("reset")}
          </Button>
        )}
      </div>
      <fieldset disabled={!own} className={own ? "min-w-0 space-y-4" : "min-w-0 space-y-4 opacity-60"}>
        {children}
      </fieldset>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("resetTitle")}</DialogTitle>
            <DialogDescription>{t("resetBody", { level })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => reset.mutateAsync(undefined).finally(() => setAsking(false))}
            >
              {t("reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
