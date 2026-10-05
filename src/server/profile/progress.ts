import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProfiles, agentStatusLog, branches } from "@/db/schema";
import { getSetting } from "../settings/service";
import {
  computeProgress,
  periodRanges,
  type DayCount,
  type Period,
  type Progress,
  type ProgressFact,
  type ProgressFeedback,
} from "@/domain/profile/progress";
import { can } from "@/domain/rbac/permissions";
import { hostedSessionFacts } from "../halls/hosted";
import type { Actor } from "../admin/actor";
import { orgOf } from "../admin/actor";
import { now as clockNow } from "../clock";

type FactRow = {
  agent_id: string | null;
  status: "COMPLETED" | "NO_SHOW";
  arrived_at: Date;
  first_called_at: Date | null;
  started_at: Date | null;
  finished_at: Date;
};

const toFact = (r: FactRow): ProgressFact => ({
  agentId: r.agent_id,
  status: r.status,
  arrivedAt: new Date(r.arrived_at).getTime(),
  firstCalledAt: r.first_called_at ? new Date(r.first_called_at).getTime() : null,
  startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
  finishedAt: new Date(r.finished_at).getTime(),
});

const toDaily = (rows: { d: string; n: number | string }[]): DayCount[] => rows.map((r) => ({ date: r.d, count: Number(r.n) }));

/** The time zone the person's days are counted in: their agent branch, else a branch they are granted, else the first branch. */
export async function timezoneFor(actor: Actor, agentBranchId: string | null): Promise<string> {
  const granted = actor.auth.grants.find((g) => g.branchId)?.branchId ?? null;
  const branchId = agentBranchId ?? granted;
  if (branchId) {
    const [b] = await db().select({ tz: branches.timezone }).from(branches).where(eq(branches.id, branchId));
    if (b) return b.tz;
  }
  const [first] = await db()
    .select({ tz: branches.timezone })
    .from(branches)
    .where(and(eq(branches.organizationId, orgOf(actor)), isNull(branches.archivedAt)))
    .orderBy(asc(branches.createdAt))
    .limit(1);
  return first?.tz ?? "UTC";
}

/**
 * The signed-in user's own numbers: served visitors, times, comparison with their previous period and with the
 * branch average (aggregate only, no colleague is named), trend and milestones for agents; tickets issued for
 * receptionists; audited actions for everyone. Only ever reads rows belonging to the user.
 */
export async function myProgress(actor: Actor, period: Period): Promise<Progress> {
  const me = actor.auth.user.id;
  const org = orgOf(actor);
  const now = clockNow();

  const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, me));
  const tz = await timezoneFor(actor, profile?.branchId ?? null);
  const windowStart = new Date(periodRanges(now, tz).month.prevFrom);
  const since = new Date(now - 400 * 86_400_000);

  const daily = async (query: ReturnType<typeof sql>) => toDaily((await db().execute<{ d: string; n: number }>(query)).rows);

  const actionsDaily = await daily(sql`
    select to_char("at" at time zone ${tz}, 'YYYY-MM-DD') as d, count(*)::int as n
    from audit_logs where actor_user_id = ${me} and "at" >= ${new Date(now - 70 * 86_400_000)}
    group by 1`);

  const issuedDaily = can(actor.auth.grants, "tickets.issue")
    ? await daily(sql`
        select to_char(arrived_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*)::int as n
        from tickets where issued_by_user_id = ${me} and arrived_at >= ${since}
        group by 1`)
    : undefined;

  let agent: Parameters<typeof computeProgress>[0]["agent"];
  if (profile) {
    const factRows = (whereSql: ReturnType<typeof sql>) =>
      db().execute<FactRow>(sql`
        select t.serving_agent_id as agent_id, t.status, t.arrived_at,
          (select min(e.at) from ticket_events e where e.ticket_id = t.id and e.type = 'CALLED') as first_called_at,
          t.started_at, t.finished_at
        from tickets t
        where t.organization_id = ${org} and t.status in ('COMPLETED', 'NO_SHOW') and t.finished_at >= ${windowStart}
          and ${whereSql}`);
    const [mine, theirs, servedDaily, branchDays, before, inWindow] = await Promise.all([
      factRows(sql`t.serving_agent_id = ${me}`),
      factRows(sql`t.branch_id = ${profile.branchId} and t.serving_agent_id is not null`),
      daily(sql`
        select to_char(finished_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*)::int as n
        from tickets where serving_agent_id = ${me} and status = 'COMPLETED' and finished_at is not null
        group by 1`),
      daily(sql`
        select to_char(finished_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*)::int as n
        from tickets where branch_id = ${profile.branchId} and status = 'COMPLETED' and finished_at >= ${since}
        group by 1`),
      db()
        .select({ status: agentStatusLog.status, at: agentStatusLog.at })
        .from(agentStatusLog)
        .where(and(eq(agentStatusLog.userId, me), lt(agentStatusLog.at, windowStart)))
        .orderBy(desc(agentStatusLog.at))
        .limit(1),
      db()
        .select({ status: agentStatusLog.status, at: agentStatusLog.at })
        .from(agentStatusLog)
        .where(and(eq(agentStatusLog.userId, me), gte(agentStatusLog.at, windowStart)))
        .orderBy(asc(agentStatusLog.at)),
    ]);
    // Visitor feedback on the agent's visits and (aggregated only) on the branch, over the last 70 days.
    const feedbackCfg = await getSetting(org, "feedback", profile.branchId);
    const feedbackOn = feedbackCfg.enabled;
    let feedback: { own: ProgressFeedback[]; branch: ProgressFeedback[] | null } | undefined;
    if (feedbackOn) {
      const rows = await db().execute<{
        agent_id: string | null;
        score: number;
        comment: string | null;
        at: Date;
        display_number: string;
      }>(sql`
        select c.agent_id, c.score, c.comment, c."at", t.display_number from csat_responses c
        join tickets t on t.id = c.ticket_id
        where c.branch_id = ${profile.branchId} and c."at" >= ${new Date(now - 70 * 86_400_000)}`);
      const all: ProgressFeedback[] = rows.rows.map((r) => ({
        agentId: r.agent_id,
        score: r.score,
        comment: r.comment,
        at: new Date(r.at).getTime(),
        // The ticket number only travels with the agent's own answers; the branch list stays anonymous.
        displayNumber: r.agent_id === me ? r.display_number : undefined,
      }));
      feedback = { own: all.filter((x) => x.agentId === me), branch: all };
    }
    agent = {
      facts: mine.rows.map(toFact),
      feedback,
      negativeThreshold: feedbackCfg.lowScoreThreshold,
      hosted: (await hostedSessionFacts(me, windowStart.getTime(), now + 1))
        .filter((s) => s.status === "CLOSED" && s.startedAt !== null && s.closedAt !== null)
        .map((s) => ({ closedAt: s.closedAt!, visitors: s.members.filter((m) => m === "ENTERED" || m === "DONE").length })),
      branchFacts: theirs.rows.map(toFact),
      statusLog: [...before, ...inWindow].map((e) => ({ status: e.status, at: e.at.getTime() })),
      servedDaily,
      branchActiveDays: branchDays.map((d) => d.date),
    };
  }

  return computeProgress({ now, timezone: tz, period, agent, issuedDaily, actionsDaily });
}
