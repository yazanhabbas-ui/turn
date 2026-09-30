import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  agentGroupMembers,
  agentProfiles,
  branches,
  distributionRules,
  priorityLevels,
  reasonAssignments,
  shifts,
  tickets,
  visitReasons,
} from "@/db/schema";
import { resolveConfig, toEngineConfig, type DistributionConfig } from "@/domain/distribution/config";
import type { AgentSkill, EngineAgent, EngineSnapshot, EngineTicket } from "@/domain/distribution/types";
import { serviceDay } from "@/domain/schedule/time";
import { shiftState } from "@/domain/shifts/window";
import { now as clockNow } from "../clock";
import { getSetting } from "../settings/service";

/** Serializes all queue mutations of a branch (issue, call, transfer, dispatch) for the rest of the transaction. */
export async function lockBranch(tx: Tx, branchId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dor:branch:${branchId}`}))`);
}

export type BranchRow = typeof branches.$inferSelect;

export type AgentShift = { id: string; name: Record<string, string>; startsAt: string; endsAt: string };

export type BranchContext = {
  branch: BranchRow;
  /** Shift of each agent that has one, and how shifts are used (off | guide | strict). */
  agentShifts: Map<string, AgentShift>;
  shiftMode: "off" | "guide" | "strict";
  shiftEndGraceMinutes: number;
  now: number;
  serviceDay: string;
  snapshot: EngineSnapshot;
  /** Resolved distribution configuration per queue id. */
  configFor: (queueId: string) => DistributionConfig;
};

export const OPEN_STATUSES = ["WAITING", "CALLED", "SERVING"] as const;

/** Loads everything the engine needs for one branch. Call after `lockBranch` for consistent decisions. */
export async function loadBranchContext(tx: Tx, branchId: string, now = clockNow()): Promise<BranchContext> {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId));
  if (!branch) throw new Error(`branch ${branchId} not found`);
  const org = branch.organizationId;
  const ticketing = await getSetting(org, "ticketing", branchId, tx);
  const work = await getSetting(org, "agentWork", branchId, tx);
  const day = serviceDay(now, branch.timezone, ticketing.dailyResetTime);

  const [ticketRows, profileRows, reasonRows, priorityRows, ruleRows, todayStats] = await Promise.all([
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
  const shiftRows = await tx.select().from(shifts).where(eq(shifts.organizationId, org));
  const shiftById = new Map(shiftRows.map((x) => [x.id, x]));
  const agentShifts = new Map<string, AgentShift>();
  for (const p of profileRows) {
    const sh = p.shiftId ? shiftById.get(p.shiftId) : undefined;
    if (sh) agentShifts.set(p.userId, { id: sh.id, name: sh.name, startsAt: sh.startsAt, endsAt: sh.endsAt });
  }
  const agents: EngineAgent[] = profileRows.map((p) => ({
    id: p.userId,
    status: p.status,
    // One visitor at a time unless the organization allows several; then the agent's own limit or the default.
    maxConcurrent: work.multipleVisitors ? (p.maxConcurrent ?? work.visitorsPerAgent) : 1,
    weight: p.weight,
    idleSince: p.lastIdleSince?.getTime() ?? p.statusChangedAt.getTime(),
    lastAssignedAt: stats.get(p.userId)?.last_at ? new Date(stats.get(p.userId)!.last_at!).getTime() : null,
    handledToday: stats.get(p.userId)?.handled ?? 0,
    skills: skills.get(p.userId)!,
    offShift: (() => {
      const sh = agentShifts.get(p.userId);
      return work.shiftMode !== "off" && !!sh && !shiftState(sh, now, branch.timezone).onShift;
    })(),
  }));

  const global = ruleRows.find((r) => r.scope === "global")?.config;
  const branchRule = ruleRows.find((r) => r.scope === "branch" && r.branchId === branchId)?.config;
  const cache = new Map<string, DistributionConfig>();
  const configFor = (queueId: string) => {
    let c = cache.get(queueId);
    if (!c) {
      c = toEngineConfig(
        resolveConfig(global, branchRule, ruleRows.find((r) => r.scope === "queue" && r.queueId === queueId)?.config),
      );
      cache.set(queueId, c);
    }
    return c;
  };

  // Who got the previous ticket of each queue: the strict rotation continues from there.
  const lastAssigned = await tx.execute<{ queue_id: string; agent_id: string }>(sql`
    select distinct on (queue_id) queue_id, assigned_agent_id as agent_id
    from tickets where branch_id = ${branchId} and assigned_agent_id is not null
    order by queue_id, assigned_at desc nulls last`);

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
    agentShifts,
    shiftMode: work.shiftMode,
    shiftEndGraceMinutes: work.shiftEndGraceMinutes,
    serviceDay: day,
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
      lastAssignedAgentByQueue: new Map(lastAssigned.rows.map((r) => [r.queue_id, r.agent_id])),
    },
  };
}
