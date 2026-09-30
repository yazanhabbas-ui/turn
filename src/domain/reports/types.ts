import type { AgentStatus } from "@/db/schema/agents";

/** One ticket as the reports see it. Built from `tickets` + a few `ticket_events` by the report service. */
export type TicketFact = {
  id: string;
  branchId: string;
  reasonId: string;
  /** The agent who served (or was serving) the ticket. */
  agentId: string | null;
  arrivedAt: number;
  /** First time the ticket was called (recalls do not move it). */
  firstCalledAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  status:
    "WAITING" | "CALLED" | "SERVING" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "ON_HOLD" | "APPOINTMENT_PENDING" | "TRANSFERRED";
  recalls: number;
  /** Agents who transferred this ticket away (one entry per TRANSFERRED event). */
  transfersOut: string[];
  /** The visitor had at least one earlier ticket. */
  returning: boolean;
  /** Who the visitor is when reception entered something that identifies them (phone, name…); null = anonymous. */
  visitorId: string | null;
  /** SLA target of the ticket's reason, in minutes. */
  slaTargetMinutes: number;
};

/** One row of `agent_status_log`: the agent entered `status` at `at`. */
export type StatusEntry = { userId: string; status: AgentStatus; at: number };

export type ReportInput = {
  facts: TicketFact[];
  /** Ordered status changes. Include the last entry before `fromMs` for each agent so the range starts in the right state. */
  statusLog: StatusEntry[];
  branches: Map<string, { name: Record<string, string>; timezone: string }>;
  reasons: Map<string, { name: Record<string, string>; color: string }>;
  agents: Map<string, { name: Record<string, string> }>;
  /** Agent shifts, and which shift each agent works (for the shift breakdown). */
  shifts?: { id: string; name: Record<string, string>; startsAt: string; endsAt: string }[];
  agentShift?: Map<string, string>;
  fromMs: number;
  /** Exclusive end. */
  toMs: number;
  now: number;
  /** "X% within Y minutes" style service level. */
  serviceLevel: { minutes: number; targetPct: number };
};

export type Spread = { avg: number; median: number; p90: number; max: number };

export type AgentReport = {
  agentId: string;
  name: Record<string, string>;
  shiftId: string | null;
  served: number;
  noShow: number;
  transferOut: number;
  transferIn: number;
  avgServiceMin: number;
  medianServiceMin: number;
  p90ServiceMin: number;
  loginMin: number;
  breakMin: number;
  availableMin: number;
  servingMin: number;
  idleMin: number;
  utilisationPct: number;
};

export type ReasonReport = {
  reasonId: string;
  name: Record<string, string>;
  color: string;
  visitors: number;
  served: number;
  avgWaitMin: number;
  p90WaitMin: number;
  avgServiceMin: number;
  p90ServiceMin: number;
  slaPct: number;
};

/** How often the same identified visitor came in the period (visitors reception recorded with a phone or name). */
export type RepeatVisitor = {
  visitorId: string;
  visits: number;
  firstAt: number;
  lastAt: number;
  /** Average days between consecutive visits. */
  avgDaysBetween: number;
  reasonIds: string[];
  /** Filled in by the report service from the visitor record (null when anonymised or unknown). */
  name?: string | null;
  phoneMasked?: string | null;
  /** The full number, only for people who may see personal data. */
  phone?: string | null;
};

export type RepeatReport = {
  /** Distinct identified visitors and how many tickets belong to them. */
  uniqueVisitors: number;
  identifiedTickets: number;
  /** Tickets with no visitor record (nothing identifying was entered). */
  anonymousTickets: number;
  repeatVisitors: number;
  repeatRatePct: number;
  avgVisits: number;
  /** Visitors by number of visits; the last bucket (5) means five or more. */
  distribution: { visits: number; visitors: number }[];
  /** Visitors with two or more visits, most visits first (at most 100). */
  top: RepeatVisitor[];
};

export type ShiftReport = {
  shiftId: string | null;
  name: Record<string, string>;
  visitors: number;
  served: number;
  avgWaitMin: number;
};

export type ReportData = {
  range: { fromMs: number; toMs: number };
  summary: {
    visitors: number;
    served: number;
    noShow: number;
    cancelled: number;
    transferred: number;
    stillOpen: number;
    wait: Spread;
    service: Spread;
    slaPct: number;
    serviceLevel: { minutes: number; targetPct: number; pct: number };
    abandonmentPct: number;
    avgWaitBeforeAbandonMin: number;
    recallRatePct: number;
    transferRatePct: number;
    returningPct: number;
    firstVisitPct: number;
    fairnessIndex: number;
  };
  byDay: { date: string; visitors: number; served: number; avgWaitMin: number }[];
  byHour: { hour: number; visitors: number; served: number; avgWaitMin: number }[];
  byWeekday: { weekday: number; visitors: number }[];
  byBranch: { branchId: string; name: Record<string, string>; visitors: number; served: number; avgWaitMin: number }[];
  byReason: ReasonReport[];
  /** Visitors by the shift in whose hours they arrived (a last row with shiftId null = outside every shift). */
  byShift: ShiftReport[];
  repeat: RepeatReport;
  heatmap: { cells: [weekday: number, hour: number, count: number][]; max: number };
  agents: AgentReport[];
  queueLengthByHour: { hour: number; avg: number; max: number }[];
  backlogByDay: { date: string; count: number }[];
  reasonMixWeekly: { weekStart: string; counts: Record<string, number> }[];
};

export type Forecast = {
  basedOnDays: number;
  /** Expected visitors per day for the next 7 days. */
  days: { date: string; weekday: number; expected: number }[];
  /** Tomorrow by hour, with the agents needed to keep up at the target utilisation. */
  tomorrow: { date: string; hours: { hour: number; expected: number; agentsNeeded: number }[] };
  avgServiceMin: number;
  targetUtilisationPct: number;
};
