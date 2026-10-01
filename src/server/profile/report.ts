import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentProfiles } from "@/db/schema";
import {
  computeAgentReport,
  customRange,
  presetRange,
  previousRange,
  rangeBounds,
  REPORT_PRESETS,
  type AgentReport,
  type ReportFact,
  type ReportRange,
} from "@/domain/profile/agent-report";
import { hostedSummary } from "@/domain/reports/halls";
import { can } from "@/domain/rbac/permissions";
import { hostedSessionFacts } from "../halls/hosted";
import type { Actor } from "../admin/actor";
import { orgOf } from "../admin/actor";
import { now as clockNow } from "../clock";
import { AppError } from "../http/errors";
import { getSetting } from "../settings/service";
import { timezoneFor } from "./progress";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Either a preset (`period`) or a custom `from` and `to` (at most 92 days). */
export const reportQuery = z
  .object({ period: z.enum(REPORT_PRESETS).optional(), from: date.optional(), to: date.optional() })
  .refine((q) => q.period || (q.from && q.to), { message: "range_required" });
export type ReportQuery = z.infer<typeof reportQuery>;

export const detailsQuery = z.object({
  outcome: z.enum(["COMPLETED", "NO_SHOW"]).optional(),
  reasonId: z.string().uuid().optional(),
  /** Cursor: the `next` of the previous page. */
  before: z
    .string()
    .regex(/^\d+_[0-9a-f-]{36}$/)
    .optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type DetailsQuery = z.infer<typeof detailsQuery>;

/** The agent's own context: the reports are for agents only. */
async function agentContext(actor: Actor) {
  const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, actor.auth.user.id));
  if (!profile) throw new AppError("forbidden", { reason: "agents_only" });
  const tz = await timezoneFor(actor, profile.branchId);
  return { profile, tz, org: orgOf(actor), me: actor.auth.user.id };
}

function resolveRange(q: ReportQuery, tz: string): ReportRange {
  if (q.period) return presetRange(q.period, clockNow(), tz);
  const r = customRange(q.from!, q.to!);
  if (!r) throw new AppError("validation", { field: "range" });
  return r;
}

type FactRow = {
  id: string;
  display_number: string;
  reason_id: string;
  reason: Record<string, string>;
  status: "COMPLETED" | "NO_SHOW";
  outcome: string | null;
  arrived_at: Date;
  first_called_at: Date | null;
  started_at: Date | null;
  finished_at: Date;
  score: number | null;
  comment: string | null;
  visitor_name: string | null;
  visitor_phone: string | null;
  visitor_anonymized_at: Date | null;
  has_visitor: boolean;
};

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);

const toFact = (r: FactRow, feedbackOn: boolean): ReportFact => ({
  id: r.id,
  displayNumber: r.display_number,
  reasonId: r.reason_id,
  reason: r.reason,
  status: r.status,
  outcome: r.outcome,
  arrivedAt: ms(r.arrived_at)!,
  firstCalledAt: ms(r.first_called_at),
  startedAt: ms(r.started_at),
  finishedAt: ms(r.finished_at)!,
  score: feedbackOn ? r.score : null,
  comment: feedbackOn ? r.comment : null,
});

const SELECT = sql`
  select t.id, t.display_number, t.reason_id, r.name as reason, t.status, t.outcome, t.arrived_at,
    (select min(e.at) from ticket_events e where e.ticket_id = t.id and e.type = 'CALLED') as first_called_at,
    t.started_at, t.finished_at, c.score, c.comment,
    v.name as visitor_name, v.phone as visitor_phone, v.anonymized_at as visitor_anonymized_at,
    (t.visitor_id is not null) as has_visitor
  from tickets t
  join visit_reasons r on r.id = t.reason_id
  left join csat_responses c on c.ticket_id = t.id
  left join visitors v on v.id = t.visitor_id`;

/** The agent's own finished tickets whose finish falls in [start, end). */
async function ownRows(org: string, me: string, start: number, end: number, extra = sql``, tail = sql``) {
  return (
    await db().execute<FactRow>(sql`${SELECT}
      where t.organization_id = ${org} and t.serving_agent_id = ${me} and t.status in ('COMPLETED', 'NO_SHOW')
        and t.finished_at >= ${new Date(start)} and t.finished_at < ${new Date(end)} ${extra}
      ${tail}`)
  ).rows;
}

/**
 * The signed-in agent's work report for a period, computed from their own served tickets only. The comparison uses
 * their own previous period of the same length and the branch as an aggregate (no colleague is named).
 * Agents only: anyone without an agent profile gets `403 forbidden` (`reason: agents_only`).
 */
export async function myReport(actor: Actor, q: ReportQuery): Promise<AgentReport> {
  const { profile, tz, org, me } = await agentContext(actor);
  const range = resolveRange(q, tz);
  const cur = rangeBounds(range, tz);
  const prev = rangeBounds(previousRange(range), tz);
  const feedbackOn = (await getSetting(org, "feedback", profile.branchId)).enabled;

  const [own, previous, branch] = await Promise.all([
    ownRows(org, me, cur.start, cur.end),
    ownRows(org, me, prev.start, prev.end),
    db().execute<FactRow>(sql`${SELECT}
      where t.branch_id = ${profile.branchId} and t.serving_agent_id is not null and t.status in ('COMPLETED', 'NO_SHOW')
        and t.finished_at >= ${new Date(cur.start)} and t.finished_at < ${new Date(cur.end)}`),
  ]);
  const hosted = hostedSummary(await hostedSessionFacts(me, cur.start, cur.end), me);
  return computeAgentReport({
    hosted,
    range,
    timezone: tz,
    facts: own.map((r) => toFact(r, feedbackOn)),
    previousFacts: previous.map((r) => toFact(r, feedbackOn)),
    branchFacts: branch.rows.map((r) => toFact(r, feedbackOn)),
    feedbackOn,
  });
}

export type DetailRow = {
  id: string;
  displayNumber: string;
  reason: Record<string, string>;
  status: "COMPLETED" | "NO_SHOW";
  outcome: string | null;
  arrivedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  finishedAt: string;
  waitMin: number | null;
  serviceMin: number | null;
  score: number | null;
  /** Visitor name; null when the ticket has no visitor record or it was anonymised. */
  visitorName: string | null;
  /** Masked (last three digits) unless the viewer holds `visitors.privacy`, like the repeat-visitors report. */
  visitorPhone: string | null;
};

const min1 = (a: number, b: number) => Math.round((Math.max(0, b - a) / 60_000) * 10) / 10;

function toDetail(r: FactRow, fullPhone: boolean, feedbackOn: boolean): DetailRow {
  const f = toFact(r, feedbackOn);
  const alive = r.has_visitor && !r.visitor_anonymized_at;
  const digits = alive ? (r.visitor_phone ?? "") : "";
  return {
    id: f.id,
    displayNumber: f.displayNumber,
    reason: f.reason,
    status: f.status,
    outcome: f.outcome,
    arrivedAt: new Date(f.arrivedAt).toISOString(),
    calledAt: f.firstCalledAt === null ? null : new Date(f.firstCalledAt).toISOString(),
    startedAt: f.startedAt === null ? null : new Date(f.startedAt).toISOString(),
    finishedAt: new Date(f.finishedAt).toISOString(),
    waitMin: f.firstCalledAt === null ? null : min1(f.arrivedAt, f.firstCalledAt),
    serviceMin: f.status === "COMPLETED" && f.startedAt !== null ? min1(f.startedAt, f.finishedAt) : null,
    score: f.score,
    visitorName: alive ? r.visitor_name : null,
    visitorPhone: digits ? (fullPhone ? digits : `••••${digits.slice(-3)}`) : null,
  };
}

/** Rows loaded for one page, or for the whole period when `limit` is null (export). */
async function detailRows(actor: Actor, q: ReportQuery, f: Omit<DetailsQuery, "limit">, limit: number | null) {
  const { profile, tz, org, me } = await agentContext(actor);
  const range = resolveRange(q, tz);
  const { start, end } = rangeBounds(range, tz);
  const feedbackOn = (await getSetting(org, "feedback", profile.branchId)).enabled;
  const fullPhone = can(actor.auth.grants, "visitors.privacy");
  let cursor = sql``;
  if (f.before) {
    const [at, id] = f.before.split("_");
    cursor = sql`and (t.finished_at, t.id) < (${new Date(Number(at))}, ${id}::uuid)`;
  }
  const extra = sql`${f.outcome ? sql`and t.status = ${f.outcome}` : sql``} ${f.reasonId ? sql`and t.reason_id = ${f.reasonId}::uuid` : sql``} ${cursor}`;
  const tail = sql`order by t.finished_at desc, t.id desc ${limit === null ? sql`limit 10000` : sql`limit ${limit + 1}`}`;
  const rows = await ownRows(org, me, start, end, extra, tail);
  return { rows: rows.map((r) => toDetail(r, fullPhone, feedbackOn)), range, tz, feedbackOn };
}

/** One page of the served-visitors detail report (newest first), filterable by outcome and reason. */
export async function myReportDetails(
  actor: Actor,
  q: ReportQuery,
  f: DetailsQuery,
): Promise<{ items: DetailRow[]; next: string | null; feedbackOn: boolean }> {
  const { rows, feedbackOn } = await detailRows(actor, q, f, f.limit);
  const items = rows.slice(0, f.limit);
  const last = items[items.length - 1];
  return {
    items,
    next: rows.length > f.limit && last ? `${new Date(last.finishedAt).getTime()}_${last.id}` : null,
    feedbackOn,
  };
}

/** Every detail row of the period (for the export), same masking as the screen. */
export async function myReportAllDetails(actor: Actor, q: ReportQuery) {
  const { rows, range, tz, feedbackOn } = await detailRows(actor, q, {}, null);
  return { rows, range, tz, feedbackOn };
}
