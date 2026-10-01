"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorState, PageHeader } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useLookups } from "../use-lookups";
import { AgentsSection } from "./sections/agents-section";
import { AlertsSection } from "./sections/alerts-section";
import { BrandingSection } from "./sections/branding-section";
import { BreakLimitSection } from "./sections/break-limit-section";
import { BreaksSection } from "./sections/breaks-section";
import { FeedbackSection } from "./sections/feedback-section";
import { PrioritiesSection } from "./sections/priorities-section";
import { PrivacySection } from "./sections/privacy-section";
import { ReceptionSection } from "./sections/reception-section";
import { RegionalSection } from "./sections/regional-section";
import { sectionsFor, SECTIONS, type SectionId } from "./sections/registry";
import { SelfCheckinSection } from "./sections/self-checkin-section";
import { RetentionSection } from "./sections/retention-section";
import { ReportsSection } from "./sections/reports-section";
import { SecuritySection } from "./sections/security-section";
import { TicketingSection } from "./sections/ticketing-section";
import type { AllSettings } from "./sections/types";
import { VisitorStatusSection } from "./sections/visitor-status-section";
import { WallboardSection } from "./sections/wallboard-section";
import { WifiSection } from "./sections/wifi-section";
import { defaultScope, ScopeSwitcher, scopeAllowed, type ScopeAccess } from "./scope-switcher";
import { ScopedSection, useSourceLabel, type Sources } from "./scoped-section";
import { SETTINGS } from "./setting-form";
import { parseScope, scopeParam, scopeQuery, SettingsScopeContext, type SettingsScope } from "./settings-context";
import { SettingsShell } from "./settings-shell";
import { WaitEstimateTab } from "./wait-estimate-tab";

function SettingsSkeleton() {
  const t = useTranslations("settings");
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="gap-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="mb-5 space-y-2 lg:mb-0">
          <Skeleton className="h-9 w-full" />
          <div className="hidden space-y-2 lg:block">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Admin, Settings. Values are inherited organization, then city, then branch; the scope switcher at the top picks the
 * level being edited (`?scope=organization | city:<id> | branch:<id>`). Organization-wide admins can edit every level,
 * a city admin their city and its branches, a branch manager their branches. The layout, search and save bar live
 * in `SettingsShell`; each section is wrapped in `ScopedSection` (source badge, override toggle, inheritance).
 */
export function SettingsPage({
  organization = true,
  cityIds = "all",
  branchIds = "all",
}: {
  organization?: boolean;
  cityIds?: string[] | "all";
  branchIds?: string[] | "all";
}) {
  const lookups = useLookups();
  const access: ScopeAccess = {
    organization,
    cityIds: organization ? "all" : cityIds,
    branchIds: organization ? "all" : branchIds,
  };
  const [picked, setPicked] = useState<SettingsScope | null>(() =>
    typeof window === "undefined" ? null : parseScope(new URLSearchParams(window.location.search).get("scope")),
  );
  if (lookups.isLoading) return <SettingsSkeleton />;
  if (lookups.isError || !lookups.data) return <ErrorState onRetry={() => lookups.refetch()} />;
  const l = lookups.data;
  const scope: SettingsScope =
    picked && scopeAllowed(access, picked, l.cities, l.branches) ? picked : defaultScope(access, l.cities, l.branches);
  return (
    <ScopedSettings
      key={scopeParam(scope)}
      scope={scope}
      onScope={(next) => {
        setPicked(next);
        const url = new URL(window.location.href);
        url.searchParams.set("scope", scopeParam(next));
        window.history.replaceState(window.history.state, "", url);
      }}
      access={access}
      organization={organization}
    />
  );
}

function ScopedSettings({
  scope,
  onScope,
  access,
  organization,
}: {
  scope: SettingsScope;
  onScope: (s: SettingsScope) => void;
  access: ScopeAccess;
  organization: boolean;
}) {
  const query = scopeQuery(scope);
  const settings = useApiQuery<AllSettings>(`${SETTINGS}${query}`);
  const sourcesQuery = useApiQuery<{ sources: Sources }>(scope.kind === "organization" ? null : `${SETTINGS}/sources${query}`);
  const lookups = useLookups();
  const sourceLabel = useSourceLabel(lookups.data?.cities ?? [], lookups.data?.branches ?? []);
  const t = useTranslations("settings.scope");
  if (settings.isLoading || lookups.isLoading) return <SettingsSkeleton />;
  if (settings.isError || !settings.data || !lookups.data) return <ErrorState onRetry={() => settings.refetch()} />;
  const s = settings.data;
  const l = lookups.data;

  const render = (id: SectionId): React.ReactNode => {
    switch (id) {
      case "branding":
        return <BrandingSection initial={s.branding} />;
      case "regional":
        return <RegionalSection initial={s.regional} />;
      case "ticketing":
        return <TicketingSection initial={s.ticketing} />;
      case "reception":
        return <ReceptionSection initial={s.reception} />;
      case "selfCheckin":
        return <SelfCheckinSection initial={s.selfCheckin} />;
      case "wifi":
        return <WifiSection initial={s.wifi} />;
      case "waitEstimate":
        return <WaitEstimateTab initial={s.waitEstimate} />;
      case "visitorStatus":
        return <VisitorStatusSection initial={s.visitorStatus} />;
      case "feedback":
        return <FeedbackSection initial={s.feedback} />;
      case "priorities":
        return <PrioritiesSection items={l.priorities} />;
      case "agents":
        return <AgentsSection initial={s.agentWork} shifts={l.shifts} />;
      case "breakLimit":
        return <BreakLimitSection initial={s.breaks} />;
      case "breaks":
        return <BreaksSection items={l.breakTypes} />;
      case "wallboard":
        return <WallboardSection initial={s.wallboard} displayTheme={s.displayTheme} branding={s.branding} />;
      case "reports":
        return <ReportsSection initial={s.reports} />;
      case "alerts":
        return <AlertsSection initial={s.alerts} />;
      case "security":
        return <SecuritySection initial={s.security} roles={l.roles} />;
      case "retention":
        return <RetentionSection initial={s.privacy} />;
      case "privacy":
        return <PrivacySection initial={s.privacy} />;
    }
  };

  const scoped = (id: SectionId): React.ReactNode => (
    <ScopedSection
      section={SECTIONS.find((x) => x.id === id)!}
      scope={scope}
      sources={sourcesQuery.data?.sources}
      values={s}
      cities={l.cities}
      branches={l.branches}
    >
      {render(id)}
    </ScopedSection>
  );

  const meta = (section: (typeof SECTIONS)[number]): string => {
    if (scope.kind === "organization")
      return t(
        section.scope === "organization" ? "appliesOrganization" : section.scope === "city" ? "appliesCity" : "appliesBranch",
      );
    const info = section.keys.length ? sourcesQuery.data?.sources[section.keys[0]!] : undefined;
    return info?.overridable ? sourceLabel(info.source) : t("sourceOrganization");
  };

  return (
    <SettingsScopeContext.Provider value={scope}>
      <SettingsShell
        sections={sectionsFor(organization)}
        render={scoped}
        meta={meta}
        topBar={<ScopeSwitcher scope={scope} onChange={onScope} access={access} cities={l.cities} branches={l.branches} />}
      />
    </SettingsScopeContext.Provider>
  );
}
