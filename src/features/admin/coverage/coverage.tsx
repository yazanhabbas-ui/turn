"use client";

import { ConciergeBell, ScanLine, UserRoundPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { BranchCoverage } from "@/server/admin/coverage";

export const COVERAGE = "/api/v1/admin/coverage";

/** How a visitor can get a ticket in each branch the viewer manages (receptionist, agent walk-in, kiosk). */
export function useCoverage() {
  return useApiQuery<{ items: BranchCoverage[] }>(COVERAGE);
}

/**
 * "Reception: staffed / not staffed" for one branch (D61), with a one-click fix when there is no way at all to issue
 * a ticket: let agents issue walk-ins, or go and add a kiosk.
 */
export function ReceptionBadge({ branchId, canManage }: { branchId: string; canManage: boolean }) {
  const t = useTranslations("coverage");
  const coverage = useCoverage();
  const enable = useApiMutation(() => api(`${COVERAGE}/${branchId}/enable-agent-issuing`, { method: "POST", body: {} }), {
    invalidate: [[COVERAGE]],
    success: t("enabled"),
  });
  const c = coverage.data?.items.find((x) => x.branchId === branchId);
  if (!c) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`coverage-${branchId}`}>
      <Badge variant={c.hasReception ? "secondary" : "outline"}>
        <ConciergeBell className="size-3" aria-hidden />
        {c.hasReception ? t("staffed") : t("notStaffed")}
      </Badge>
      {!c.hasReception && c.agentAllowed && <Badge variant="outline">{t("agentIssuingOn")}</Badge>}
      {c.kiosks.paired > 0 && (
        <Badge variant="outline">
          <ScanLine className="size-3" aria-hidden />
          {t("kiosks", { count: c.kiosks.paired })}
        </Badge>
      )}
      {!c.canIssue && (
        <>
          <Badge variant="destructive">{t("noWay")}</Badge>
          {canManage && (
            <Button variant="outline" size="xs" disabled={enable.isPending} onClick={() => enable.mutate(undefined)}>
              <UserRoundPlus aria-hidden />
              {t("enableAgent")}
            </Button>
          )}
          <Button variant="outline" size="xs" nativeButton={false} render={<Link href="/admin/screens" />}>
            <ScanLine aria-hidden />
            {t("addKiosk")}
          </Button>
        </>
      )}
    </div>
  );
}

/** For a city card: how many of its branches have no receptionist, and how many cannot issue tickets at all. */
export function CityCoverage({ cityId }: { cityId: string }) {
  const t = useTranslations("coverage");
  const coverage = useCoverage();
  const list = (coverage.data?.items ?? []).filter((b) => b.cityId === cityId);
  if (!list.length) return null;
  const noReception = list.filter((b) => !b.hasReception).length;
  const noWay = list.filter((b) => !b.canIssue).length;
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid={`city-coverage-${cityId}`}>
      <Badge variant={noReception ? "outline" : "secondary"}>
        <ConciergeBell className="size-3" aria-hidden />
        {noReception ? t("cityNoReception", { count: noReception }) : t("cityAllStaffed")}
      </Badge>
      {noWay > 0 && <Badge variant="destructive">{t("cityNoWay", { count: noWay })}</Badge>}
    </div>
  );
}
