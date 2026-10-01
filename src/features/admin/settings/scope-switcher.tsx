"use client";

import { Building2, Landmark, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { Branch, City } from "../types";
import { useText } from "../use-lookups";
import { useSettingsShell, type SettingsScope } from "./settings-context";

export type ScopeAccess = {
  /** May edit the organization default (organization-wide administrators). */
  organization: boolean;
  /** Cities the user can edit as a whole; `"all"` for organization-wide administrators. */
  cityIds: string[] | "all";
  /** Branches the user can edit; `"all"` for organization-wide administrators. */
  branchIds: string[] | "all";
};

export const canEditCity = (a: ScopeAccess, id: string) => a.organization || a.cityIds === "all" || a.cityIds.includes(id);
const ownsBranch = (a: ScopeAccess, id: string) => a.branchIds === "all" || a.branchIds.includes(id);

/** Cities the user can pick (a branch-level manager gets the cities of their branches, to find their branch). */
export function visibleCities(a: ScopeAccess, cities: City[], branches: Branch[]) {
  if (a.organization) return cities;
  return cities.filter((c) => canEditCity(a, c.id) || branches.some((b) => b.cityId === c.id && ownsBranch(a, b.id)));
}

export function visibleBranches(a: ScopeAccess, branches: Branch[]) {
  return branches.filter((b) => ownsBranch(a, b.id));
}

/** The scope to start on: the organization for its administrators, otherwise the first city, else the first branch. */
export function defaultScope(a: ScopeAccess, cities: City[], branches: Branch[]): SettingsScope {
  if (a.organization) return { kind: "organization" };
  const city = visibleCities(a, cities, branches).find((c) => canEditCity(a, c.id));
  if (city) return { kind: "city", id: city.id };
  const branch = visibleBranches(a, branches)[0];
  return branch ? { kind: "branch", id: branch.id } : { kind: "organization" };
}

/** Whether a scope (for example from a link) is one this user may open. */
export function scopeAllowed(a: ScopeAccess, s: SettingsScope, cities: City[], branches: Branch[]) {
  if (s.kind === "organization") return a.organization;
  if (s.kind === "city") return cities.some((c) => c.id === s.id) && canEditCity(a, s.id);
  return visibleBranches(a, branches).some((b) => b.id === s.id);
}

/**
 * "Applies to: Organization | City | Branch". Settings are inherited organization, then city, then branch; this picks
 * the level the page edits. Switching asks first when there are unsaved edits.
 */
export function ScopeSwitcher({
  scope,
  onChange,
  access,
  cities,
  branches,
}: {
  scope: SettingsScope;
  onChange: (s: SettingsScope) => void;
  access: ScopeAccess;
  cities: City[];
  branches: Branch[];
}) {
  const t = useTranslations("settings.scope");
  const text = useText();
  const shell = useSettingsShell();
  const change = (s: SettingsScope) => shell.guard(() => onChange(s));

  const cityList = visibleCities(access, cities, branches);
  const branchList = visibleBranches(access, branches);
  const branchRow = scope.kind === "branch" ? branches.find((b) => b.id === scope.id) : undefined;
  const cityId = scope.kind === "city" ? scope.id : (branchRow?.cityId ?? "");
  const cityBranches = branchList.filter((b) => b.cityId === cityId);

  return (
    <div
      className="bg-card mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border p-3 shadow-sm md:p-4"
      role="group"
      aria-label={t("label")}
    >
      <div className="self-center text-sm font-semibold max-sm:w-full">{t("label")}</div>
      {access.organization && (
        <Button
          type="button"
          variant={scope.kind === "organization" ? "default" : "outline"}
          aria-pressed={scope.kind === "organization"}
          className="max-lg:h-10"
          onClick={() => change({ kind: "organization" })}
        >
          <Landmark aria-hidden />
          {t("organization")}
        </Button>
      )}
      {cityList.length > 0 && (
        <label className="flex min-w-40 flex-col gap-1 text-xs font-medium max-sm:flex-1">
          <span className="text-muted-foreground flex items-center gap-1">
            <Building2 className="size-3.5" aria-hidden />
            {t("city")}
          </span>
          <NativeSelect
            aria-label={t("city")}
            className={cn("max-lg:h-10", scope.kind !== "organization" && "border-brand")}
            value={cityId}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              if (canEditCity(access, id)) change({ kind: "city", id });
              else {
                const first = branchList.find((b) => b.cityId === id);
                if (first) change({ kind: "branch", id: first.id });
              }
            }}
          >
            {scope.kind === "organization" && <option value="">{t("chooseCity")}</option>}
            {cityList.map((c) => (
              <option key={c.id} value={c.id}>
                {text(c.name)}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {cityId && cityBranches.length > 0 && (
        <label className="flex min-w-40 flex-col gap-1 text-xs font-medium max-sm:flex-1">
          <span className="text-muted-foreground flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {t("branch")}
          </span>
          <NativeSelect
            aria-label={t("branch")}
            className={cn("max-lg:h-10", scope.kind === "branch" && "border-brand")}
            value={scope.kind === "branch" ? scope.id : ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) change({ kind: "branch", id });
              else if (canEditCity(access, cityId)) change({ kind: "city", id: cityId });
            }}
          >
            {(canEditCity(access, cityId) || scope.kind !== "branch") && <option value="">{t("wholeCity")}</option>}
            {cityBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {text(b.name)}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
    </div>
  );
}
