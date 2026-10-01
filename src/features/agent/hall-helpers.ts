import type { AgentWorkspace, HallConsole, HallMemberStatus } from "../queue/types";

/** Outcomes the host can record when finishing (shared by the desk and the hall dialogs). */
export const OUTCOMES = ["resolved", "follow_up", "referred", "info"] as const;

/** Keeps a group size between 1 and the most that can be called; 0 when nobody can be called. */
export function clampGroupSize(n: number, max: number): number {
  if (!Number.isFinite(max) || max < 1) return 0;
  if (!Number.isFinite(n)) return Math.floor(max);
  return Math.max(1, Math.min(Math.floor(max), Math.floor(n)));
}

/** The largest group the stepper offers: what the hall allows, never more than can be called right now. */
export function stepperMax(maxCall: number, callable: number): number {
  if (maxCall < 1) return 0;
  return callable > 0 ? Math.min(maxCall, callable) : maxCall;
}

/** Message key and colour classes (tokens) of a visitor's status inside a session. */
export const MEMBER_STATUS: Record<HallMemberStatus, { key: string; tone: string }> = {
  CALLED: { key: "called", tone: "bg-status-called/10 text-status-called" },
  ENTERED: { key: "entered", tone: "bg-status-serving/10 text-status-serving" },
  DONE: { key: "done", tone: "bg-status-done/10 text-status-done" },
  NO_SHOW: { key: "noShow", tone: "bg-status-cancelled/10 text-status-cancelled" },
  RELEASED: { key: "released", tone: "bg-muted text-muted-foreground" },
};

export type NoCallReason = "none" | "waiting_empty" | "below_min" | "full";

/** Why the "call next group" button is disabled (null when a group can be called). */
export function noCallReason(hall: Pick<HallConsole, "waiting" | "callable" | "maxCall">): NoCallReason | null {
  if (hall.callable > 0) return null;
  if (hall.maxCall < 1) return "full";
  if (hall.waiting === 0) return "waiting_empty";
  return "below_min";
}

export type SessionFlags = {
  called: number;
  entered: number;
  canEnterAll: boolean;
  canStart: boolean;
  startEnabled: boolean;
  canTopUp: boolean;
  canRecall: boolean;
  canClose: boolean;
  canCancel: boolean;
};

/** What the host may do with the open session, from its visitors and the hall settings. */
export function sessionFlags(hall: Pick<HallConsole, "settings" | "waiting" | "callable" | "maxCall" | "session">): SessionFlags {
  const s = hall.session;
  const members = s?.tickets ?? [];
  const called = members.filter((m) => m.status === "CALLED").length;
  const entered = members.filter((m) => m.status === "ENTERED").length;
  const open = s?.status === "OPEN";
  return {
    called,
    entered,
    canEnterAll: !!s && called > 0,
    canStart: open,
    startEnabled: open && entered > 0,
    canTopUp: open && hall.settings.allowTopUp && hall.maxCall > 0 && hall.waiting > 0 && hall.callable > 0,
    canRecall: !!s && called > 0,
    canClose: !!s && entered > 0,
    canCancel: !!s && entered === 0,
  };
}

/**
 * Desk or hall (D62): the hall the agent is signed in to wins, then the desk; with neither, the default hall when the
 * agent has no default desk. Without the feature everything is a desk.
 */
export function workMode(
  profile: Pick<AgentWorkspace["profile"], "currentDeskId" | "currentHallId" | "defaultDeskId" | "defaultHallId"> | undefined,
  hasHalls: boolean,
): "desk" | "hall" {
  if (!profile || !hasHalls) return "desk";
  if (profile.currentHallId) return "hall";
  if (profile.currentDeskId) return "desk";
  return profile.defaultHallId && !profile.defaultDeskId ? "hall" : "desk";
}
