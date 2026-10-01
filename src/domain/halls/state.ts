import type { TicketStatus } from "../tickets/state-machine";

/**
 * How a hall session maps onto the ticket state machine (D62):
 *   call group  -> every ticket WAITING -> CALLED (to the hall)
 *   visitor in  -> CALLED -> SERVING
 *   close       -> SERVING -> COMPLETED, CALLED (never came) -> NO_SHOW
 *   release     -> CALLED -> WAITING (requeue) or SERVING -> WAITING (transfer), keeping the original queue time
 * No new ticket status or transition exists; the session rows follow the tickets.
 */
export type HallTicketStatus = "CALLED" | "ENTERED" | "NO_SHOW" | "DONE" | "RELEASED";
export type HallSessionStatus = "OPEN" | "IN_SESSION" | "CLOSED" | "CANCELLED";

export const LIVE_SESSION: ReadonlySet<HallSessionStatus> = new Set(["OPEN", "IN_SESSION"]);
/** Members that still count against the hall's capacity. */
export const ACTIVE_MEMBER: ReadonlySet<HallTicketStatus> = new Set(["CALLED", "ENTERED"]);

/** The member status that follows a ticket's status. */
export function memberStatusFor(ticket: TicketStatus): HallTicketStatus {
  switch (ticket) {
    case "SERVING":
      return "ENTERED";
    case "CALLED":
      return "CALLED";
    case "COMPLETED":
      return "DONE";
    case "NO_SHOW":
      return "NO_SHOW";
    default:
      // WAITING, ON_HOLD, CANCELLED, APPOINTMENT_PENDING: the visitor left the session.
      return "RELEASED";
  }
}

/**
 * The session status after a change of its members.
 *  - nobody active any more: CLOSED when someone was served or missed, CANCELLED when the session never took place;
 *  - OPEN and everyone has entered (and auto-start is on): IN_SESSION.
 */
export function nextSessionStatus(
  session: { status: HallSessionStatus; started: boolean },
  members: readonly { status: HallTicketStatus }[],
  autoStartWhenAllEntered: boolean,
): HallSessionStatus {
  if (!LIVE_SESSION.has(session.status)) return session.status;
  const active = members.filter((m) => ACTIVE_MEMBER.has(m.status));
  const entered = active.filter((m) => m.status === "ENTERED").length;
  if (!active.length) {
    const took = session.started || members.some((m) => m.status === "DONE" || m.status === "NO_SHOW");
    return took ? "CLOSED" : "CANCELLED";
  }
  if (session.status === "OPEN" && autoStartWhenAllEntered && entered === active.length) return "IN_SESSION";
  return session.status;
}

/** Occupancy in percent of the capacity. */
export function occupancyPct(visitors: number, capacity: number): number {
  return capacity > 0 ? Math.round((visitors / capacity) * 100) : 0;
}
