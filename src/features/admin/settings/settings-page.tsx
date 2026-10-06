"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorState, PageHeader } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useLookups } from "../use-lookups";
import { sectionsFor, SECTIONS, type SectionId } from "./sections/registry";
import type { AllSettings } from "./sections/types";
import { defaultScope, ScopeSwitcher, scopeAllowed, type ScopeAccess } from "./scope-switcher";
import { ScopedSection, useSourceLabel, type Sources } from "./scoped-section";
import { SETTINGS } from "./setting-form";
import { parseScope, scopeParam, scopeQuery, SettingsScopeContext, type SettingsScope } from "./settings-context";
import { SettingsShell } from "./settings-shell";

/** A section fetches its own code the first time it is opened, so the settings page itself stays small. */
function SectionLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

const AgentsSection = dynamic(() => import("./sections/agents-section").then((m) => m.AgentsSection), {
  loading: () => <SectionLoading />,
});
const AlertsSection = dynamic(() => import("./sections/alerts-section").then((m) => m.AlertsSection), {
  loading: () => <SectionLoading />,
});
const HelpCenterSection = dynamic(() => import("./sections/help-center-section").then((m) => m.HelpCenterSection), {
  loading: () => <SectionLoading />,
});
const BrandingSection = dynamic(() => import("./sections/branding-section").then((m) => m.BrandingSection), {
  loading: () => <SectionLoading />,
});
const BreakLimitSection = dynamic(() => import("./sections/break-limit-section").then((m) => m.BreakLimitSection), {
  loading: () => <SectionLoading />,
});
const BreaksSection = dynamic(() => import("./sections/breaks-section").then((m) => m.BreaksSection), {
  loading: () => <SectionLoading />,
});
const FeedbackSection = dynamic(() => import("./sections/feedback-section").then((m) => m.FeedbackSection), {
  loading: () => <SectionLoading />,
});
const PageContentSection = dynamic(() => import("./sections/page-content-section").then((m) => m.PageContentSection), {
  loading: () => <SectionLoading />,
});
const PrioritiesSection = dynamic(() => import("./sections/priorities-section").then((m) => m.PrioritiesSection), {
  loading: () => <SectionLoading />,
});
const PrivacySection = dynamic(() => import("./sections/privacy-section").then((m) => m.PrivacySection), {
  loading: () => <SectionLoading />,
});
const ReceptionSection = dynamic(() => import("./sections/reception-section").then((m) => m.ReceptionSection), {
  loading: () => <SectionLoading />,
});
const RegionalSection = dynamic(() => import("./sections/regional-section").then((m) => m.RegionalSection), {
  loading: () => <SectionLoading />,
});
const HallsSection = dynamic(() => import("./sections/halls-section").then((m) => m.HallsSection), {
  loading: () => <SectionLoading />,
});
const SelfCheckinSection = dynamic(() => import("./sections/self-checkin-section").then((m) => m.SelfCheckinSection), {
  loading: () => <SectionLoading />,
});
const RetentionSection = dynamic(() => import("./sections/retention-section").then((m) => m.RetentionSection), {
  loading: () => <SectionLoading />,
});
const ReportsSection = dynamic(() => import("./sections/reports-section").then((m) => m.ReportsSection), {
  loading: () => <SectionLoading />,
});
const SecuritySection = dynamic(() => import("./sections/security-section").then((m) => m.SecuritySection), {
  loading: () => <SectionLoading />,
});
const TicketingSection = dynamic(() => import("./sections/ticketing-section").then((m) => m.TicketingSection), {
  loading: () => <SectionLoading />,
});
const VisitorStatusSection = dynamic(() => import("./sections/visitor-status-section").then((m) => m.VisitorStatusSection), {
  loading: () => <SectionLoading />,
});
const WallboardSection = dynamic(() => import("./sections/wallboard-section").then((m) => m.WallboardSection), {
  loading: () => <SectionLoading />,
});
const WifiSection = dynamic(() => import("./sections/wifi-section").then((m) => m.WifiSection), {
  loading: () => <SectionLoading />,
});
const WaitEstimateTab = dynamic(() => import("./wait-estimate-tab").then((m) => m.WaitEstimateTab), {
  loading: () => <SectionLoading />,
});

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
      case "helpCenter":
        return <HelpCenterSection initial={s.helpCenter} />;
      case "visitorStatus":
        return <VisitorStatusSection initial={s.visitorStatus} />;
      case "pageContent":
        return <PageContentSection initial={s.pageContent} all={s} />;
      case "feedback":
        return <FeedbackSection initial={s.feedback} />;
      case "priorities":
        return <PrioritiesSection items={l.priorities} />;
      case "agents":
        return <AgentsSection initial={s.agentWork} shifts={l.shifts} />;
      case "halls":
        return <HallsSection initial={s.halls} />;
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
    // At the organization level the badge would only repeat what the page already says, so it is left out there.
    if (scope.kind === "organization") return "";
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
