import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import {
  agentGroupMembers,
  agentProfiles,
  branches,
  distributionRules,
  holidays,
  pauseWindows,
  priorityLevels,
  reasonAssignments,
  scheduleRules,
  tickets,
  visitReasons,
} from "@/db/schema";
import { resolveConfig, type DistributionConfig } from "@/domain/distribution/config";
import type { AgentSkill, EngineAgent, EngineSnapshot, EngineTicket } from "@/domain/distribution/types";
import { activePause, type PauseWindowInput } from "@/domain/schedule/hours";
import { prayerMinutes } from "@/domain/schedule/prayer";
import { serviceDay, zonedParts } from "@/domain/schedule/time";
import { now as clockNow } from "../clock";
import { getSetting } from "../settings/service";

/** Serializes all queue mutations of a branch (issue, call, transfer, dispatch) for the rest of the transaction. */
export async function lockBranch(tx: Tx, branchId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dor:branch:${branchId}`}))`);
}

export type BranchRow = typeof branches.$inferSelect;

export type BranchContext = {
  branch: BranchRow;
  now: number;
  serviceDay: string;
  snapshot: EngineSnapshot;
  pause: { pause: PauseWindowInput; endsAtMinute: number } | null;
  ramadan: { enabled: boolean; from: string | null; to: string | null };
  /** Resolved distribution configuration per queue id. */
  configFor: (queueId: string) => DistributionConfig;
};

export const OPEN_STATUSES = ["WAITING", "CALLED", "SERVING"] as const;

/** Loads everything the engine needs for one branch. Call after `lockBranch` for consistent decisions. */
export async function loadBranchContext(tx: Tx, branchId: string, now = clockNow()): Promise<BranchContext> {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId));
  if (!branch) throw new Error(`branch ${branchId} not found`);
  const org = branch.organizationId;
  const [ticketing, regional] = await Promise.all([
    getSetting(org, "ticketing", branchId, tx),
    getSetting(org, "regional", branchId, tx),
  ]);
  const day = serviceDay(now, branch.timezone, ticketing.dailyResetTime);

  const [ticketRows, profileRows, reasonRows, priorityRows, ruleRows, pauseRows, todayStats] = await Promise.all([
    tx
      .select({
        id: tickets.id,
        queueId: tickets.queueId,
        reasonId: tickets.reasonId,
        status: tickets.status,
        priorityKey: tickets.priorityKey,
        assignedAgentId: tickets.assignedAgentId,
        assignedAt: tickets.assignedAt,
        queuedAt: tickets.queuedAt,
        servingAgentId: tickets.servingAgentId,
        appointmentId: tickets.appointmentId,
        visitorId: tickets.visitorId,
        lastAgentId: sql<string | null>`(select last_agent_id from visitors v where v.id = ${tickets.visitorId})`,
        appointmentAt: sql<Date | null>`(select scheduled_at from appointments a where a.id = ${tickets.appointmentId})`,
      })
      .from(tickets)
      .where(and(eq(tickets.branchId, branchId), inArray(tickets.status, [...OPEN_STATUSES]))),
    tx.select().from(agentProfiles).where(eq(agentProfiles.branchId, branchId)),
    tx.select().from(visitReasons).where(eq(visitReasons.organizationId, org)),
    tx
      .select()
      .from(priorityLevels)
      .where(and(eq(priorityLevels.organizationId, org), isNull(priorityLevels.archivedAt))),
    tx.select().from(distributionRules).where(eq(distributionRules.organizationId, org)),
    tx.select().from(pauseWindows).where(eq(pauseWindows.branchId, branchId)),
    tx.execute<{ agent_id: string; handled: number; last_at: Date | null }>(sql`
      select serving_agent_id as agent_id, count(*)::int as handled, max(called_at) as last_at
      from tickets where branch_id = ${branchId} and service_day = ${day} and serving_agent_id is not null
      group by serving_agent_id`),
  ]);

  // Skills: direct assignments plus group assignments, best proficiency wins, primary if any is primary.
  const agentIds = profileRows.map((p) => p.userId);
  const [memberships, assignments] = await Promise.all([
    agentIds.length ? tx.select().from(agentGroupMembers).where(inArray(agentGroupMembers.userId, agentIds)) : [],
    tx
      .select()
      .from(reasonAssignments)
      .innerJoin(visitReasons, eq(visitReasons.id, reasonAssignments.reasonId))
      .where(
        and(
          eq(visitReasons.organizationId, org),
          isNull(visitReasons.archivedAt),
          or(isNull(reasonAssignments.branchId), eq(reasonAssignments.branchId, branchId)),
        ),
      ),
  ]);
  const skills = new Map<string, Map<string, AgentSkill>>(agentIds.map((id) => [id, new Map()]));
  const give = (userId: string, reasonId: string, s: AgentSkill) => {
    const m = skills.get(userId);
    if (!m) return;
    const prev = m.get(reasonId);
    m.set(
      reasonId,
      prev ? { proficiency: Math.max(prev.proficiency, s.proficiency), isPrimary: prev.isPrimary || s.isPrimary } : s,
    );
  };
  for (const { reason_assignments: a } of assignments) {
    const s = { proficiency: a.proficiency, isPrimary: a.isPrimary };
    if (a.userId) give(a.userId, a.reasonId, s);
    if (a.groupId) for (const m of memberships) if (m.groupId === a.groupId) give(m.userId, a.reasonId, s);
  }

  const stats = new Map(todayStats.rows.map((r) => [r.agent_id, r]));
  const agents: EngineAgent[] = profileRows.map((p) => ({
    id: p.userId,
    status: p.status,
    maxConcurrent: p.maxConcurrent,
    weight: p.weight,
    idleSince: p.lastIdleSince?.getTime() ?? p.statusChangedAt.getTime(),
    lastAssignedAt: stats.get(p.userId)?.last_at ? new Date(stats.get(p.userId)!.last_at!).getTime() : null,
    handledToday: stats.get(p.userId)?.handled ?? 0,
    skills: skills.get(p.userId)!,
  }));

  const global = ruleRows.find((r) => r.scope === "global")?.config;
  const branchRule = ruleRows.find((r) => r.scope === "branch" && r.branchId === branchId)?.config;
  const cache = new Map<string, DistributionConfig>();
  const configFor = (queueId: string) => {
    let c = cache.get(queueId);
    if (!c) {
      c = resolveConfig(global, branchRule, ruleRows.find((r) => r.scope === "queue" && r.queueId === queueId)?.config);
      cache.set(queueId, c);
    }
    return c;
  };

  const lat = branch.latitude ? Number(branch.latitude) : null;
  const lng = branch.longitude ? Number(branch.longitude) : null;
  const today = zonedParts(now, branch.timezone).date;
  let prayers: Record<string, number> | null = null;
  const prayerMinute = (name: string) => {
    if (lat === null || lng === null) return null;
    prayers ??= prayerMinutes(today, branch.timezone, lat, lng);
    return prayers[name] ?? null;
  };
  const pause = activePause(now, branch.timezone, pauseRows, { ramadan: regional.ramadanMode, prayerMinute });

  const engineTickets: EngineTicket[] = ticketRows.map((t) => ({
    id: t.id,
    queueId: t.queueId,
    reasonId: t.reasonId,
    status: t.status,
    priorityKey: t.priorityKey,
    assignedAgentId: t.assignedAgentId,
    assignedAt: t.assignedAt?.getTime() ?? null,
    queuedAt: t.queuedAt.getTime(),
    appointmentAt: t.appointmentAt ? new Date(t.appointmentAt).getTime() : null,
    lastAgentId: t.lastAgentId,
    servingAgentId: t.servingAgentId,
  }));

  return {
    branch,
    now,
    serviceDay: day,
    pause,
    ramadan: regional.ramadanMode,
    configFor,
    snapshot: {
      now,
      tickets: engineTickets,
      agents,
      reasons: new Map(
        reasonRows.map((r) => [
          r.id,
          { id: r.id, slaMinutes: r.slaTargetWaitMinutes, expectedMinutes: r.expectedServiceMinutes },
        ]),
      ),
      priorities: new Map(priorityRows.map((p) => [p.key, { weight: p.weight, isLane: p.isLane }])),
      configFor,
      paused: !!pause,
    },
  };
}

/** Schedule rules and holidays relevant to issuing tickets for a reason in a branch. */
export async function loadIssuingRules(tx: DbOrTx, organizationId: string, branchId: string, scheduleId: string | null) {
  const [rules, hols] = await Promise.all([
    scheduleId ? tx.select().from(scheduleRules).where(eq(scheduleRules.scheduleId, scheduleId)) : Promise.resolve(null),
    tx
      .select()
      .from(holidays)
      .where(and(eq(holidays.organizationId, organizationId), or(isNull(holidays.branchId), eq(holidays.branchId, branchId)))),
  ]);
  return { rules, holidays: hols };
}
