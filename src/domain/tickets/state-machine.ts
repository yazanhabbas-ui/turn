/**
 * Ticket lifecycle. The server applies every change through `transition()`; illegal moves throw.
 *
 *   APPOINTMENT_PENDING ─check_in─▶ WAITING ─call─▶ CALLED ─start─▶ SERVING ─complete─▶ COMPLETED
 *                                     ▲  │            │  ▲recall        │
 *                        resume/requeue  hold         no_show           hold/transfer
 *                                     │  ▼            ▼                 ▼
 *                                   ON_HOLD        NO_SHOW          (WAITING in another queue)
 *   Any non-terminal state ─cancel─▶ CANCELLED.  TRANSFERRED is an event, not a state: the ticket returns to WAITING.
 */
export const TICKET_STATUSES = [
  "APPOINTMENT_PENDING",
  "WAITING",
  "CALLED",
  "SERVING",
  "ON_HOLD",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type TicketAction =
  | "check_in"
  | "call"
  | "recall"
  | "start"
  | "complete"
  | "no_show"
  | "requeue"
  | "transfer"
  | "hold"
  | "resume"
  | "cancel"
  | "assign"
  | "release";

export const TERMINAL: ReadonlySet<TicketStatus> = new Set(["COMPLETED", "NO_SHOW", "CANCELLED"]);
/** States in which the ticket occupies an agent (counts toward max concurrent). */
export const ACTIVE_WITH_AGENT: ReadonlySet<TicketStatus> = new Set(["CALLED", "SERVING"]);

const TABLE: Record<TicketAction, Partial<Record<TicketStatus, TicketStatus>>> = {
  check_in: { APPOINTMENT_PENDING: "WAITING" },
  call: { WAITING: "CALLED" },
  recall: { CALLED: "CALLED" },
  start: { CALLED: "SERVING" },
  complete: { SERVING: "COMPLETED" },
  no_show: { CALLED: "NO_SHOW" },
  // No-show policy "send to end of queue", or undo of an accidental no-show.
  requeue: { CALLED: "WAITING", NO_SHOW: "WAITING" },
  transfer: { WAITING: "WAITING", CALLED: "WAITING", SERVING: "WAITING", ON_HOLD: "WAITING" },
  hold: { WAITING: "ON_HOLD", CALLED: "ON_HOLD", SERVING: "ON_HOLD" },
  resume: { ON_HOLD: "WAITING" },
  cancel: { APPOINTMENT_PENDING: "CANCELLED", WAITING: "CANCELLED", CALLED: "CANCELLED", ON_HOLD: "CANCELLED" },
  // Reserve a waiting ticket for an agent (push / manual / sticky) or release it back to the pool.
  assign: { WAITING: "WAITING" },
  release: { WAITING: "WAITING" },
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TicketStatus,
    readonly action: TicketAction,
  ) {
    super(`Cannot ${action} a ticket in status ${from}`);
  }
}

export function canTransition(from: TicketStatus, action: TicketAction): boolean {
  return TABLE[action][from] !== undefined;
}

export function transition(from: TicketStatus, action: TicketAction): TicketStatus {
  const to = TABLE[action][from];
  if (!to) throw new InvalidTransitionError(from, action);
  return to;
}

/** Actions available from a status (drives which buttons the UI shows). */
export function allowedActions(from: TicketStatus): TicketAction[] {
  return (Object.keys(TABLE) as TicketAction[]).filter((a) => TABLE[a][from] !== undefined);
}

/** Event type recorded in ticket_events for an action. */
export const EVENT_TYPE: Record<TicketAction, string> = {
  check_in: "CHECKED_IN",
  call: "CALLED",
  recall: "RECALLED",
  start: "STARTED",
  complete: "COMPLETED",
  no_show: "NO_SHOW",
  requeue: "REQUEUED",
  transfer: "TRANSFERRED",
  hold: "HELD",
  resume: "RESUMED",
  cancel: "CANCELLED",
  assign: "ASSIGNED",
  release: "RELEASED",
};

/**
 * Accidental final actions that can be undone within the configured window: the ticket returns to the
 * status recorded as `fromStatus` on that event (e.g. NO_SHOW → CALLED, COMPLETED → SERVING).
 */
export const UNDOABLE_EVENTS: ReadonlySet<string> = new Set(["NO_SHOW", "COMPLETED", "CANCELLED"]);

export function undoTarget(
  lastEvent: { type: string; fromStatus: TicketStatus | null; at: number },
  now: number,
  windowSeconds: number,
): TicketStatus | null {
  if (!UNDOABLE_EVENTS.has(lastEvent.type) || !lastEvent.fromStatus) return null;
  if (now - lastEvent.at > windowSeconds * 1000) return null;
  return lastEvent.fromStatus;
}
