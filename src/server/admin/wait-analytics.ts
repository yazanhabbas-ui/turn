import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, visitReasons } from "@/db/schema";
import { AppError } from "../http/errors";
import { reasonWaitStats } from "../queue/wait-analytics";
import { getSetting } from "../settings/service";
import { orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

/**
 * Real service durations per reason next to the configured expected time, for the Waiting time settings tab.
 * Needs reports.view for the branch (organization-wide for the whole-organization view).
 */
export async function waitAnalytics(actor: Actor, branchId: string | null) {
  const org = orgOf(actor);
  let timezone: string;
  if (branchId) {
    requirePermission(actor, "reports.view", branchId);
    const [b] = await db().select().from(branches).where(eq(branches.id, branchId));
    if (!b || b.organizationId !== org) throw new AppError("not_found");
    timezone = b.timezone;
  } else {
    requireOrgWide(actor, "reports.view");
    const rows = await db()
      .select()
      .from(branches)
      .where(and(eq(branches.organizationId, org), isNull(branches.archivedAt)))
      .orderBy(asc(branches.createdAt));
    timezone = rows[0]?.timezone ?? "UTC";
  }
  const settings = await getSetting(org, "waitEstimate", branchId);
  const reasons = await db()
    .select()
    .from(visitReasons)
    .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt)))
    .orderBy(asc(visitReasons.sortOrder));
  const stats = await reasonWaitStats(
    db(),
    { branchId, organizationId: org, timezone },
    settings,
    reasons.map((r) => ({ id: r.id, expectedMinutes: r.expectedServiceMinutes })),
  );
  return {
    lookbackDays: settings.lookbackDays,
    minSamples: settings.minSamples,
    reasons: stats.map((s) => ({ ...s, name: reasons.find((r) => r.id === s.reasonId)?.name ?? {} })),
  };
}
