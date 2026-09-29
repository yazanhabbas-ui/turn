import type { TicketStatus } from "../tickets/state-machine";
import type { DistributionConfig } from "./config";

/**
 * In-memory snapshot the engine decides on. The server builds it from the database inside a locked
 * transaction; the simulator builds it from synthetic data. The engine never does I/O.
 * All times are epoch milliseconds.
 */
export type EngineTicket = {
  id: string;
  queueId: string;
  reasonId: string;
  status: TicketStatus;
  priorityKey: string | null;
  /** Agent the ticket is reserved for (push / hybrid / manual / sticky), if any. */
  assignedAgentId: string | null;
  assignedAt: number | null;
  /** Ordering clock: original arrival (kept on transfer) or the time it was sent to the end of the queue. */
  queuedAt: number;
  appointmentAt: number | null;
  /** Agent who served this visitor last time (sticky routing). */
  lastAgentId: string | null;
  servingAgentId: string | null;
};

export const AGENT_STATUSES = ["AVAILABLE", "BUSY", "ON_BREAK", "AWAY", "OFFLINE"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type AgentSkill = { proficiency: number; isPrimary: boolean };

export type EngineAgent = {
  id: string;
  status: AgentStatus;
  maxConcurrent: number;
  weight: number;
  /** Since when the agent has had no active ticket (for "longest idle"). */
  idleSince: number | null;
  /** Last time a ticket was assigned or called (for round robin). */
  lastAssignedAt: number | null;
  /** Tickets called today (for weighted fairness). */
  handledToday: number;
  /** reasonId → skill for this agent in this branch (direct or via group; the best one wins). */
  skills: Map<string, AgentSkill>;
};

export type EngineReason = { id: string; slaMinutes: number; expectedMinutes: number };

export type PriorityInfo = { weight: number; isLane: boolean };

export type EngineSnapshot = {
  now: number;
  tickets: EngineTicket[];
  agents: EngineAgent[];
  reasons: Map<string, EngineReason>;
  priorities: Map<string, PriorityInfo>;
  /** Configuration effective for a queue. */
  configFor: (queueId: string) => DistributionConfig;
  /** Service paused (prayer time / custom pause) — no new calls or assignments. */
  paused?: boolean;
  /** Deterministic randomness (seeded in simulation and tests). */
  random?: () => number;
};
