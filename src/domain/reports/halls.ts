import { occupancyPct } from "../halls/state";
import type { HallTicketStatus } from "../halls/state";

/** One group session as the reports see it (D62). Built from `hall_sessions` + `hall_session_tickets`. */
export type HallSessionFact = {
  sessionId: string;
  hallId: string;
  branchId: string;
  hostAgentId: string;
  status: "OPEN" | "IN_SESSION" | "CLOSED" | "CANCELLED";
  /** The hall's capacity when the session was opened. */
  capacity: number;
  calledAt: number;
  startedAt: number | null;
  closedAt: number | null;
  /** Member statuses (one entry per visitor ever called into the session). */
  members: HallTicketStatus[];
};

/** Hall details the report shows; `archived` halls with sessions in the period still appear. */
export type HallInfo = { number: string; name: Record<string, string>; branchId: string };

export type HallReport = {
  hallId: string;
  number: string;
  name: Record<string, string>;
  branchId: string;
  /** Sessions that took place (closed, with a start). */
  sessions: number;
  /** Visitors who entered, in all those sessions. */
  visitors: number;
  /** Average visitors who entered per session. */
  avgGroupSize: number;
  /** Average of visitors / capacity (capacity of each session), in percent. */
  occupancyPct: number;
  avgSessionMin: number;
  /** Visitors called into the hall's closed sessions, and how many of them did not come. */
  called: number;
  noShow: number;
  noShowRatePct: number;
};

const MIN = 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** A visitor who came into the hall (entered, and so possibly finished). */
const came = (s: HallTicketStatus) => s === "ENTERED" || s === "DONE";

/**
 * Per hall: sessions held, average group size, occupancy, session length and no-show rate. Only closed sessions
 * count (open or cancelled ones did not take place); halls with none are left out. Busiest hall first.
 */
export function computeHallReport(sessions: readonly HallSessionFact[], halls: ReadonlyMap<string, HallInfo>): HallReport[] {
  const closed = sessions.filter((s) => s.status === "CLOSED");
  const ids = [...new Set(closed.map((s) => s.hallId))];
  return ids
    .map((hallId): HallReport => {
      const list = closed.filter((s) => s.hallId === hallId);
      const held = list.filter((s) => s.startedAt !== null);
      const sizes = held.map((s) => s.members.filter(came).length);
      const lengths = held.map((s) => (s.closedAt === null ? 0 : Math.max(0, s.closedAt - s.startedAt!) / MIN));
      const called = list.reduce((n, s) => n + s.members.length, 0);
      const noShow = list.reduce((n, s) => n + s.members.filter((m) => m === "NO_SHOW").length, 0);
      const info = halls.get(hallId);
      return {
        hallId,
        number: info?.number ?? "",
        name: info?.name ?? {},
        branchId: info?.branchId ?? list[0].branchId,
        sessions: held.length,
        visitors: sizes.reduce((a, b) => a + b, 0),
        avgGroupSize: round1(mean(sizes)),
        occupancyPct: round1(mean(held.map((s, i) => occupancyPct(sizes[i], s.capacity)))),
        avgSessionMin: round1(mean(lengths)),
        called,
        noShow,
        noShowRatePct: called ? round1((noShow / called) * 100) : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** Hosting totals for one agent over the period (the profile report). */
export type HostedSummary = { sessions: number; visitors: number };

export function hostedSummary(sessions: readonly HallSessionFact[], agentId: string): HostedSummary {
  const mine = sessions.filter((s) => s.status === "CLOSED" && s.startedAt !== null && s.hostAgentId === agentId);
  return { sessions: mine.length, visitors: mine.reduce((n, s) => n + s.members.filter(came).length, 0) };
}
