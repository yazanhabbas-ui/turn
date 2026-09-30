"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import type { PickerOption } from "@/components/admin/agent-picker";
import { pickText } from "@/i18n/locales";
import type { Lookups } from "./types";

/** Picker options from the admin lookups: every language of the name is searchable, plus e-mail and branch. */
export function useAgentOptions(lookups: Pick<Lookups, "agents" | "branches">, only?: (a: Lookups["agents"][number]) => boolean) {
  const locale = useLocale();
  return useMemo<PickerOption[]>(() => {
    const branches = new Map(lookups.branches.map((b) => [b.id, pickText(b.name, locale)]));
    return lookups.agents
      .filter((a) => !only || only(a))
      .map((a) => ({
        id: a.id,
        label: pickText(a.displayName, locale, a.email),
        altLabels: Object.values(a.displayName ?? {}).filter(Boolean),
        email: a.email,
        branch: branches.get(a.branchId) ?? null,
        subtitle: a.email,
      }));
    // `only` is a per-render closure; callers pass values that change with the data they close over.
  }, [lookups.agents, lookups.branches, locale, only]);
}
