import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentProfiles, agentStatusLog, branches, shifts, tickets, users, visitReasons, visitors } from "@/db/schema";
import type { FeedbackFact } from "@/domain/feedback/csat";
import { computeForecast, computeReport } from "@/domain/reports/compute";
import type { StatusEntry, TicketFact } from "@/domain/reports/types";
import { zonedParts, zonedToUtc } from "@/domain/schedule/time";
import { isoDate, uuid } from "@/domain/validation";
import { branchesFor, can } from "@/domain/rbac/permissions";
import type { Actor } from "../admin/actor";
import { orgOf, requirePermission } from "../admin/actor";
import { now as clockNow } from "../clock";
import { AppError } from "../http/errors";
import { getSetting } from "../settings/service";

const MAX_DAYS = 92;

export const reportFilters = z.object({
  from: isoDate,
  to: isoDate,
  branchId: uuid.optional(),
  reasonId: uuid.optional(),
  agentId: uuid.optional(),
  /** Arrival weekdays to include (0 = Sunday). */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** Arrival hours to include, inclusive (0-23). */
  hourFrom: z.number().int().min(0).max(23).optional(),
  hourTo: z.number().int().min(0).max(23).optional(),
});
export type ReportFilters = z.infer<typeof reportFilters>;

/** Parses the query string of the report endpoints (`weekdays=0,1,2`). */
export function filtersFromQuery(q: URLSearchParams): ReportFilters {
  const num = (k: string) => (q.get(k) === null || q.get(k) === "" ? undefined : Number(q.get(k)));
  return reportFilters.parse({
    from: q.get("from"),
    to: q.get("to"),
    branchId: q.get("branchId") || undefined,
    reasonId: q.get("reasonId") || undefined,
    agentId: q.get("agentId") || undefined,
    weekdays: q.get("weekdays") ? q.get("weekdays")!.split(",").map(Number) : undefined,
    hourFrom: num("hourFrom"),
    hourTo: num("hourTo"),
  });
}

/** Branches the actor may see reports for, optionally narrowed to one. */
async function reportBranches(actor: Actor, permission: "reports.view" | "wallboard.view", branchId?: string) {
  requirePermission(actor, permission);
  const all = await db()
    .select()
    .from(branches)
    .where(and(eq(branches.organizationId, orgOf(actor)), isNull(branches.archivedAt)))
    .orderBy(asc(branches.createdAt));
  const allowed = branchesFor(actor.auth.grants, permission);
  const visible = all.filter((b) => allowed === "all" || allowed.includes(b.id));
  if (branchId) {
    const one = visible.find((b) => b.id === branchId);
    if (!one) throw new AppError("forbidden", { permission });
    return [one];
  }
  if (!visible.length) throw new AppError("forbidden", { permission });
  return visible;
}

export async function reportMeta(actor: Actor) {
  const bs = await reportBranches(actor, "reports.view");
  const org = orgOf(actor);
  const [reasons, agents] = await Promise.all([
    db()
      .select({ id: visitReasons.id, name: visitReasons.name, color: visitReasons.color })
      .from(visitReasons)
      .where(eq(visitReasons.organizationId, org))
      .orderBy(asc(visitReasons.sortOrder)),
    db()
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(and(eq(users.organizationId, org), sql`exists (select 1 from agent_profiles p where p.user_id = ${users.id})`)),
  ]);
  return { branches: bs.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone })), reasons, agents };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The full KPI set for a filter (see src/domain/reports/types.ts). Computed from tickets, ticket_events and the agent status log. */
export async function buildReport(actor: Actor, f: ReportFilters) {
  const bs = await reportBranches(actor, "reports.view", f.branchId);
  // Full phone numbers of repeat visitors only for people who may see personal data.
  return buildReportForBranches(orgOf(actor), bs, f, can(actor.auth.grants, "visitors.privacy"));
}

/**
 * The same report without an acting user, for scheduled emails. The schedule's scope (one branch or the whole
 * organization) was checked against the creator's `reports.schedule` grants when it was saved, so the run itself
 * does not depend on the creator still being signed in or holding the grant.
 */
export async function buildScheduledReport(organizationId: string, f: ReportFilters) {
  const all = await db()
    .select()
    .from(branches)
    .where(and(eq(branches.organizationId, organizationId), isNull(branches.archivedAt)))
    .orderBy(asc(branches.createdAt));
  const bs = f.branchId ? all.filter((b) => b.id === f.branchId) : all;
  if (!bs.length) throw new AppError("not_found");
  return buildReportForBranches(organizationId, bs, f);
}

async function buildReportForBranches(org: string, bs: (typeof branches.$inferSelect)[], f: ReportFilters, fullPhone = false) {
  const span = daysBetween(f.from, f.to);
  if (span < 1) throw new AppError("validation", { field: "to", reason: "invalid_range" });
  if (span > MAX_DAYS) throw new AppError("validation", { field: "to", reason: "range_too_long", max: MAX_DAYS });

  const branchIds = bs.map((b) => b.id);
  const tz = bs[0].timezone;
  const fromMs = zonedToUtc(f.from, "00:00", tz);
  const toMs = zonedToUtc(f.to, "23:59", tz) + 60_000;
  const now = clockNow();

  const rows = await db().execute<{
    id: string;
    branch_id: string;
    reason_id: string;
    agent_id: string | null;
    arrived_at: Date;
    first_called_at: Date | null;
    started_at: Date | null;
    finished_at: Date | null;
    status: TicketFact["status"];
    recall_count: number;
    returning: boolean;
    visitor_id: string | null;
    transfers: string[] | null;
  }>(sql`
    select t.id, t.branch_id, t.reason_id, t.visitor_id, t.serving_agent_id as agent_id, t.arrived_at,
      (select min(e.at) from ticket_events e where e.ticket_id = t.id and e.type = 'CALLED') as first_called_at,
      t.started_at, t.finished_at, t.status, t.recall_count,
      (t.visitor_id is not null and exists (
         select 1 from tickets p where p.visitor_id = t.visitor_id and p.arrived_at < t.arrived_at)) as returning,
      (select array_agg(coalesce(e.agent_id, e.actor_user_id)::text) from ticket_events e
         where e.ticket_id = t.id and e.type = 'TRANSFERRED') as transfers
    from tickets t
    where t.organization_id = ${org}
      and t.branch_id in (${sql.join(
        branchIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      and t.service_day between ${f.from} and ${f.to}
      ${f.reasonId ? sql`and t.reason_id = ${f.reasonId}` : sql``}
  `);

  const reasonRows = await db().select().from(visitReasons).where(eq(visitReasons.organizationId, org));
  const reasons = new Map(reasonRows.map((r) => [r.id, r]));
  const tzOf = new Map(bs.map((b) => [b.id, b.timezone]));

  let facts: TicketFact[] = rows.rows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    reasonId: r.reason_id,
    agentId: r.agent_id,
    arrivedAt: new Date(r.arrived_at).getTime(),
    firstCalledAt: r.first_called_at ? new Date(r.first_called_at).getTime() : null,
    startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).getTime() : null,
    status: r.status,
    recalls: r.recall_count,
    transfersOut: (r.transfers ?? []).filter(Boolean),
    returning: !!r.returning,
    visitorId: r.visitor_id,
    slaTargetMinutes: reasons.get(r.reason_id)?.slaTargetWaitMinutes ?? 15,
  }));

  // Filters that depend on the arrival time in the branch's own time zone, and on the serving agent.
  if (f.weekdays || f.hourFrom !== undefined || f.hourTo !== undefined) {
    facts = facts.filter((t) => {
      const p = zonedParts(t.arrivedAt, tzOf.get(t.branchId) ?? tz);
      const hour = Math.floor(p.minutes / 60);
      return (
        (!f.weekdays || f.weekdays.includes(p.weekday)) &&
        (f.hourFrom === undefined || hour >= f.hourFrom) &&
        (f.hourTo === undefined || hour <= f.hourTo)
      );
    });
  }
  if (f.agentId) facts = facts.filter((t) => t.agentId === f.agentId || t.transfersOut.includes(f.agentId!));

  // Status log: entries in range plus each agent's last entry before it.
  const inRange = await db()
    .select({ userId: agentStatusLog.userId, status: agentStatusLog.status, at: agentStatusLog.at })
    .from(agentStatusLog)
    .where(
      and(
        inArray(agentStatusLog.branchId, branchIds),
        gte(agentStatusLog.at, new Date(fromMs)),
        lt(agentStatusLog.at, new Date(toMs)),
        f.agentId ? eq(agentStatusLog.userId, f.agentId) : undefined,
      ),
    )
    .orderBy(asc(agentStatusLog.at));
  const before = await db().execute<{ user_id: string; status: StatusEntry["status"]; at: Date }>(sql`
    select distinct on (user_id) user_id, status, at from agent_status_log
    where branch_id in (${sql.join(
      branchIds.map((id) => sql`${id}`),
      sql`, `,
    )}) and at < ${new Date(fromMs)}
      ${f.agentId ? sql`and user_id = ${f.agentId}` : sql``}
    order by user_id, at desc`);
  const statusLog: StatusEntry[] = [
    ...before.rows.map((r) => ({ userId: r.user_id, status: r.status, at: new Date(r.at).getTime() })),
    ...inRange.map((r) => ({ userId: r.userId, status: r.status, at: r.at.getTime() })),
  ];

  const agentNames = await db()
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(eq(users.organizationId, org));
  const settings = await getSetting(org, "reports", f.branchId ?? null);
  const feedbackSettings = await getSetting(org, "feedback", f.branchId ?? null);

  // Visitor feedback for the tickets of the period (the domain code keeps those of the filtered tickets).
  const feedbackRows = await db().execute<{
    id: string;
    ticket_id: string;
    score: number;
    nps: number | null;
    comment: string | null;
    at: Date;
    display_number: string;
  }>(sql`
    select c.id, c.ticket_id, c.score, c.nps, c.comment, c.at, t.display_number
    from csat_responses c join tickets t on t.id = c.ticket_id
    where t.organization_id = ${org}
      and t.branch_id in (${sql.join(
        branchIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      and t.service_day between ${f.from} and ${f.to}`);
  const feedback: FeedbackFact[] = feedbackRows.rows.map((r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    score: r.score,
    nps: r.nps,
    comment: r.comment,
    at: new Date(r.at).getTime(),
    displayNumber: r.display_number,
  }));

  const shiftRows = await db()
    .select()
    .from(shifts)
    .where(and(eq(shifts.organizationId, org), isNull(shifts.archivedAt)))
    .orderBy(asc(shifts.sortOrder), asc(shifts.startsAt));
  const profileShifts = await db()
    .select({ userId: agentProfiles.userId, shiftId: agentProfiles.shiftId })
    .from(agentProfiles)
    .where(eq(agentProfiles.organizationId, org));

  const data = computeReport({
    facts,
    statusLog,
    branches: new Map(bs.map((b) => [b.id, { name: b.name, timezone: b.timezone }])),
    reasons: new Map(reasonRows.map((r) => [r.id, { name: r.name, color: r.color }])),
    agents: new Map(agentNames.map((u) => [u.id, { name: u.name }])),
    fromMs,
    toMs,
    now,
    serviceLevel: { minutes: settings.serviceLevelMinutes, targetPct: settings.serviceLevelTargetPct },
    feedback,
    lowScoreThreshold: feedbackSettings.lowScoreThreshold,
    shifts: shiftRows.map((x) => ({ id: x.id, name: x.name, startsAt: x.startsAt, endsAt: x.endsAt })),
    agentShift: new Map(profileShifts.filter((p) => p.shiftId).map((p) => [p.userId, p.shiftId!])),
  });
  await describeVisitors(data.repeat.top, fullPhone);
  await describeVisitors(data.csat.lowComments, fullPhone);
  return { filters: f, timezone: tz, generatedAt: new Date(now).toISOString(), data };
}

/** Expected volume for the next week and tomorrow's staffing, from the recent history of the branch. */
export async function buildForecast(actor: Actor, branchId?: string) {
  const bs = await reportBranches(actor, "reports.view", branchId);
  const org = orgOf(actor);
  const tz = bs[0].timezone;
  const settings = await getSetting(org, "reports", branchId ?? null);
  const now = clockNow();
  const today = zonedParts(now, tz).date;
  const historyDays: string[] = [];
  for (let i = 1; i <= settings.forecastHistoryDays; i++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    historyDays.push(d.toISOString().slice(0, 10));
  }
  const ids = bs.map((b) => b.id);
  const rows = await db()
    .select({
      arrivedAt: tickets.arrivedAt,
      branchId: tickets.branchId,
      startedAt: tickets.startedAt,
      finishedAt: tickets.finishedAt,
      status: tickets.status,
    })
    .from(tickets)
    .where(
      and(
        inArray(tickets.branchId, ids),
        gte(tickets.serviceDay, historyDays[historyDays.length - 1]),
        lt(tickets.serviceDay, today),
      ),
    );
  const svc = rows
    .filter((r) => r.status === "COMPLETED" && r.startedAt && r.finishedAt)
    .map((r) => (r.finishedAt!.getTime() - r.startedAt!.getTime()) / 60_000);
  const reasonAvg = await db()
    .select({ m: visitReasons.expectedServiceMinutes })
    .from(visitReasons)
    .where(eq(visitReasons.organizationId, org));
  const avgService = svc.length
    ? svc.reduce((a, b) => a + b, 0) / svc.length
    : reasonAvg.length
      ? reasonAvg.reduce((a, b) => a + b.m, 0) / reasonAvg.length
      : 10;
  return computeForecast({
    arrivals: rows.map((r) => ({ at: r.arrivedAt.getTime(), branchId: r.branchId })),
    timezone: tz,
    historyDays,
    today,
    avgServiceMin: avgService,
    targetUtilisationPct: settings.targetUtilisationPct,
  });
}

export { can, reportBranches };

/** Adds who the visitors are (repeat visitors, low-score comments): the name, and the phone number masked (in full only when permitted). */
async function describeVisitors(
  top: { visitorId: string | null; name?: string | null; phoneMasked?: string | null; phone?: string | null }[],
  fullPhone: boolean,
) {
  const ids = top.map((t) => t.visitorId).filter((x): x is string => !!x);
  if (!ids.length) return;
  const rows = await db()
    .select({ id: visitors.id, name: visitors.name, phone: visitors.phone, anonymizedAt: visitors.anonymizedAt })
    .from(visitors)
    .where(inArray(visitors.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const t of top) {
    const v = t.visitorId ? byId.get(t.visitorId) : undefined;
    t.name = v && !v.anonymizedAt ? v.name : null;
    const digits = v && !v.anonymizedAt ? (v.phone ?? "") : "";
    t.phoneMasked = digits ? `••••${digits.slice(-3)}` : null;
    t.phone = fullPhone && digits ? digits : null;
  }
}
