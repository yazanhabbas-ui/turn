import { ACTIVE_WITH_AGENT } from "../tickets/state-machine";
import type { DistributionConfig } from "./config";
import { orderTickets } from "./ordering";
import { pickAgent, type AgentCandidate } from "./strategies";
import type { EngineAgent, EngineSnapshot, EngineTicket } from "./types";

const MIN = 60_000;
/** Only AVAILABLE agents receive new work. BUSY (e.g. paperwork) keeps reservations but gets nothing new. */
export function isWorking(agent: EngineAgent): boolean {
  return agent.status === "AVAILABLE";
}

/** Present at the desk: reservations are kept. Break, away and offline release them. */
export function isPresent(agent: EngineAgent): boolean {
  return agent.status === "AVAILABLE" || agent.status === "BUSY";
}

export type QueueStats = { waiting: number; oldestWaitMinutes: number };

/**
 * Indexes over a snapshot, built once per decision so every check is O(1) instead of rescanning all
 * tickets (the engine runs inside a DB lock and inside the simulator's event loop, so it must be cheap).
 * Mutations made by `dispatch` are applied to the index incrementally.
 */
class View {
  readonly waiting: EngineTicket[] = [];
  private active = new Map<string, number>();
  private reserved = new Map<string, number>();
  private stats = new Map<string, QueueStats>();
  private overflow = new Map<string, boolean>();

  constructor(readonly s: EngineSnapshot) {
    const oldest = new Map<string, number>();
    for (const t of s.tickets) {
      if (t.status === "WAITING") {
        this.waiting.push(t);
        const st = this.stats.get(t.queueId) ?? { waiting: 0, oldestWaitMinutes: 0 };
        st.waiting++;
        this.stats.set(t.queueId, st);
        oldest.set(t.queueId, Math.min(oldest.get(t.queueId) ?? Infinity, t.queuedAt));
        if (t.assignedAgentId && s.configFor(t.queueId).capacity.countAssignedWaiting)
          this.bump(this.reserved, t.assignedAgentId, 1);
      } else if (t.servingAgentId && ACTIVE_WITH_AGENT.has(t.status)) {
        this.bump(this.active, t.servingAgentId, 1);
      }
    }
    for (const [q, st] of this.stats) st.oldestWaitMinutes = (s.now - oldest.get(q)!) / MIN;
  }

  private bump(m: Map<string, number>, k: string, d: number) {
    m.set(k, (m.get(k) ?? 0) + d);
  }

  activeLoad(agentId: string) {
    return this.active.get(agentId) ?? 0;
  }

  totalLoad(agentId: string) {
    return this.activeLoad(agentId) + (this.reserved.get(agentId) ?? 0);
  }

  reserve(t: EngineTicket, agentId: string) {
    if (this.s.configFor(t.queueId).capacity.countAssignedWaiting) this.bump(this.reserved, agentId, 1);
  }

  queueStats(queueId: string): QueueStats {
    return this.stats.get(queueId) ?? { waiting: 0, oldestWaitMinutes: 0 };
  }

  overflowActive(queueId: string): boolean {
    let v = this.overflow.get(queueId);
    if (v === undefined) {
      const cfg = this.s.configFor(queueId);
      const st = this.queueStats(queueId);
      v =
        cfg.overflow.enabled && (st.waiting > cfg.overflow.maxQueueLength || st.oldestWaitMinutes >= cfg.overflow.maxWaitMinutes);
      this.overflow.set(queueId, v);
    }
    return v;
  }

  hasCapacity(agent: EngineAgent, mode: "active" | "total") {
    return (mode === "active" ? this.activeLoad(agent.id) : this.totalLoad(agent.id)) < agent.maxConcurrent;
  }

  /** Is some other primary agent for this reason working and free right now? */
  primaryAvailable(reasonId: string, exceptId?: string): boolean {
    return this.s.agents.some(
      (a) => a.id !== exceptId && isWorking(a) && a.skills.get(reasonId)?.isPrimary && this.hasCapacity(a, "active"),
    );
  }

  /**
   * Primaries can always serve; backups only during overflow, or when no primary is free (if allowed).
   */
  canServe(agent: EngineAgent, ticket: EngineTicket): boolean {
    const skill = agent.skills.get(ticket.reasonId);
    if (!skill) return false;
    if (skill.isPrimary) return true;
    if (this.overflowActive(ticket.queueId)) return true;
    return this.s.configFor(ticket.queueId).overflow.backupsWhenNoPrimary && !this.primaryAvailable(ticket.reasonId, agent.id);
  }
}

export function activeLoad(s: EngineSnapshot, agentId: string): number {
  return new View(s).activeLoad(agentId);
}

export function totalLoad(s: EngineSnapshot, agentId: string): number {
  return new View(s).totalLoad(agentId);
}

export function queueStats(s: EngineSnapshot, queueId: string): QueueStats {
  return new View(s).queueStats(queueId);
}

/** Overflow: the queue is over its length or wait limit, so backup agents may help. */
export function overflowActive(s: EngineSnapshot, queueId: string): boolean {
  return new View(s).overflowActive(queueId);
}

export function canServe(s: EngineSnapshot, agent: EngineAgent, ticket: EngineTicket): boolean {
  return new View(s).canServe(agent, ticket);
}

export type CallDecision =
  { ticket: EngineTicket; reserved: boolean } | { ticket: null; reason: "not_working" | "at_capacity" | "empty" };

/**
 * "Call next" for an agent. Tickets reserved for the agent come first (the distribution already chose them),
 * then the shared pool in queue order. Manual-mode queues never hand out unassigned tickets.
 */
export function selectTicketForAgent(s: EngineSnapshot, agentId: string): CallDecision {
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent || !isWorking(agent)) return { ticket: null, reason: "not_working" };
  const v = new View(s);
  if (!v.hasCapacity(agent, "active")) return { ticket: null, reason: "at_capacity" };

  const mine = v.waiting.filter((t) => t.assignedAgentId === agentId);
  if (mine.length) return { ticket: orderTickets(mine, s.now, s.configFor, s.reasons, s.priorities)[0], reserved: true };

  const pool = v.waiting.filter(
    (t) => t.assignedAgentId === null && s.configFor(t.queueId).mode !== "manual" && v.canServe(agent, t),
  );
  if (!pool.length) return { ticket: null, reason: "empty" };
  return { ticket: orderTickets(pool, s.now, s.configFor, s.reasons, s.priorities)[0], reserved: false };
}

export type AssignDecision = { agentId: string; via: "sticky" | "push" } | null;

function decide(s: EngineSnapshot, v: View, ticket: EngineTicket, cfg: DistributionConfig): AssignDecision {
  if (ticket.status !== "WAITING" || ticket.assignedAgentId || cfg.mode === "manual") return null;

  if (cfg.sticky.enabled && ticket.lastAgentId) {
    const prev = s.agents.find((a) => a.id === ticket.lastAgentId);
    if (prev && isWorking(prev) && prev.skills.has(ticket.reasonId)) return { agentId: prev.id, via: "sticky" };
  }
  if (cfg.mode !== "push" && cfg.mode !== "hybrid") return null;

  const candidates: AgentCandidate[] = [];
  for (const a of s.agents) {
    if (!isWorking(a) || !v.hasCapacity(a, "total") || !v.canServe(a, ticket)) continue;
    candidates.push({ agent: a, load: v.totalLoad(a.id), proficiency: a.skills.get(ticket.reasonId)?.proficiency ?? 0 });
  }
  const primaries = candidates.filter((c) => c.agent.skills.get(ticket.reasonId)?.isPrimary);
  const chosen = pickAgent(primaries.length ? primaries : candidates, cfg.push.strategies, {
    now: s.now,
    random: s.random ?? Math.random,
  });
  return chosen ? { agentId: chosen.id, via: "push" } : null;
}

/** Chooses an agent to reserve a waiting ticket for (sticky returning visitor, or push / hybrid modes). */
export function selectAgentForTicket(s: EngineSnapshot, ticket: EngineTicket): AssignDecision {
  return decide(s, new View(s), ticket, s.configFor(ticket.queueId));
}

export type Assignment = { ticketId: string; agentId: string; via: "sticky" | "push" };

/**
 * Reserves agents for every unassigned waiting ticket that the mode allows, in queue order, updating the
 * snapshot as it goes so each decision sees the load created by the previous one.
 */
export function dispatch(s: EngineSnapshot): Assignment[] {
  const v = new View(s);
  const candidates = v.waiting.filter((t) => {
    if (t.assignedAgentId) return false;
    const cfg = s.configFor(t.queueId);
    return cfg.mode === "push" || cfg.mode === "hybrid" || (cfg.sticky.enabled && t.lastAgentId);
  });
  if (!candidates.length) return [];
  const out: Assignment[] = [];
  for (const t of orderTickets(candidates, s.now, s.configFor, s.reasons, s.priorities)) {
    const d = decide(s, v, t, s.configFor(t.queueId));
    if (!d) continue;
    t.assignedAgentId = d.agentId;
    t.assignedAt = s.now;
    v.reserve(t, d.agentId);
    s.agents.find((a) => a.id === d.agentId)!.lastAssignedAt = s.now;
    out.push({ ticketId: t.id, ...d });
  }
  return out;
}

export type Release = { ticketId: string; agentId: string; cause: "agent_unavailable" | "accept_timeout" };

/**
 * Reservations to undo: the agent stopped working (break, away, offline), or — in hybrid mode and for sticky
 * reservations — the agent did not call the ticket within the accept timeout.
 */
export function expiredReservations(s: EngineSnapshot): Release[] {
  const out: Release[] = [];
  const agents = new Map(s.agents.map((a) => [a.id, a]));
  for (const t of s.tickets) {
    if (t.status !== "WAITING" || !t.assignedAgentId) continue;
    const agent = agents.get(t.assignedAgentId);
    const cfg = s.configFor(t.queueId);
    if (!agent || !isPresent(agent)) {
      if (cfg.mode !== "manual") out.push({ ticketId: t.id, agentId: t.assignedAgentId, cause: "agent_unavailable" });
      continue;
    }
    const timed = cfg.mode === "hybrid" || (cfg.mode !== "push" && cfg.mode !== "manual" && cfg.sticky.enabled);
    if (timed && t.assignedAt !== null && s.now - t.assignedAt >= cfg.hybrid.acceptTimeoutMinutes * MIN) {
      out.push({ ticketId: t.id, agentId: t.assignedAgentId, cause: "accept_timeout" });
    }
  }
  return out;
}
