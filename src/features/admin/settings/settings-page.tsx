"use client";

import { useTranslations } from "next-intl";
import { ErrorState, PageHeader } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useLookups } from "../use-lookups";
import { AgentsSection } from "./sections/agents-section";
import { AlertsSection } from "./sections/alerts-section";
import { BrandingSection } from "./sections/branding-section";
import { BreakLimitSection } from "./sections/break-limit-section";
import { BreaksSection } from "./sections/breaks-section";
import { PrioritiesSection } from "./sections/priorities-section";
import { PrivacySection } from "./sections/privacy-section";
import { ReceptionSection } from "./sections/reception-section";
import { RegionalSection } from "./sections/regional-section";
import { sectionsFor, type SectionId } from "./sections/registry";
import { ReportsSection } from "./sections/reports-section";
import { SecuritySection } from "./sections/security-section";
import { TicketingSection } from "./sections/ticketing-section";
import type { AllSettings } from "./sections/types";
import { VisitorStatusSection } from "./sections/visitor-status-section";
import { WallboardSection } from "./sections/wallboard-section";
import { WifiSection } from "./sections/wifi-section";
import { SETTINGS } from "./setting-form";
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
 * Admin, Settings. `organization` is true for organization-wide admins; a city or branch admin only gets the sections
 * a branch may own (Wi-Fi, waiting time). The layout, search and save bar live in `SettingsShell`.
 */
export function SettingsPage({ organization = true }: { organization?: boolean }) {
  const settings = useApiQuery<AllSettings>(SETTINGS);
  const lookups = useLookups();
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
      case "wifi":
        return <WifiSection defaults={s.wifi} branches={l.branches} organization={organization} />;
      case "waitEstimate":
        return <WaitEstimateTab defaults={s.waitEstimate} branches={l.branches} organization={organization} />;
      case "visitorStatus":
        return <VisitorStatusSection initial={s.visitorStatus} />;
      case "priorities":
        return <PrioritiesSection items={l.priorities} />;
      case "agents":
        return <AgentsSection initial={s.agentWork} shifts={l.shifts} />;
      case "breakLimit":
        return <BreakLimitSection initial={s.breaks} />;
      case "breaks":
        return <BreaksSection items={l.breakTypes} />;
      case "wallboard":
        return <WallboardSection initial={s.wallboard} />;
      case "reports":
        return <ReportsSection initial={s.reports} />;
      case "alerts":
        return <AlertsSection initial={s.alerts} />;
      case "security":
        return <SecuritySection initial={s.security} roles={l.roles} />;
      case "privacy":
        return <PrivacySection initial={s.privacy} />;
    }
  };

  return <SettingsShell sections={sectionsFor(organization)} render={render} />;
}
