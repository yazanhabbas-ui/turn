import { describe, expect, it } from "vitest";
import {
  allowedActions,
  canTransition,
  InvalidTransitionError,
  TERMINAL,
  TICKET_STATUSES,
  transition,
  type TicketAction,
} from "@/domain/tickets/state-machine";

describe("ticket state machine", () => {
  it("follows the happy path", () => {
    let s = transition("APPOINTMENT_PENDING", "check_in");
    expect(s).toBe("WAITING");
    s = transition(s, "call");
    expect(s).toBe("CALLED");
    expect(transition(s, "recall")).toBe("CALLED");
    s = transition(s, "start");
    expect(s).toBe("SERVING");
    expect(transition(s, "complete")).toBe("COMPLETED");
  });

  it("transfers back to WAITING from any active state and supports hold/resume", () => {
    for (const from of ["WAITING", "CALLED", "SERVING", "ON_HOLD"] as const) expect(transition(from, "transfer")).toBe("WAITING");
    expect(transition(transition("SERVING", "hold"), "resume")).toBe("WAITING");
  });

  it("no-show can be requeued (end of queue / undo)", () => {
    expect(transition("CALLED", "no_show")).toBe("NO_SHOW");
    expect(transition("NO_SHOW", "requeue")).toBe("WAITING");
  });

  it("rejects illegal transitions", () => {
    expect(() => transition("WAITING", "complete")).toThrow(InvalidTransitionError);
    expect(() => transition("SERVING", "call")).toThrow(InvalidTransitionError);
    expect(() => transition("COMPLETED", "cancel")).toThrow(InvalidTransitionError);
    expect(canTransition("SERVING", "cancel")).toBe(false);
  });

  it("terminal states allow nothing except requeue of a no-show", () => {
    const actions: TicketAction[] = [
      "check_in",
      "call",
      "recall",
      "start",
      "complete",
      "no_show",
      "requeue",
      "transfer",
      "hold",
      "resume",
      "cancel",
      "assign",
      "release",
    ];
    for (const s of TERMINAL) {
      const allowed = actions.filter((a) => canTransition(s, a));
      expect(allowed).toEqual(s === "NO_SHOW" ? ["requeue"] : []);
    }
  });

  it("every status has a defined set of actions", () => {
    for (const s of TICKET_STATUSES) expect(Array.isArray(allowedActions(s))).toBe(true);
    expect(allowedActions("CALLED").sort()).toEqual(["cancel", "hold", "no_show", "recall", "requeue", "start", "transfer"]);
  });
});

describe("undo", () => {
  it("restores the previous status within the window only", async () => {
    const { undoTarget } = await import("@/domain/tickets/state-machine");
    expect(undoTarget({ type: "NO_SHOW", fromStatus: "CALLED", at: 0 }, 60_000, 120)).toBe("CALLED");
    expect(undoTarget({ type: "COMPLETED", fromStatus: "SERVING", at: 0 }, 121_000, 120)).toBeNull();
    expect(undoTarget({ type: "CALLED", fromStatus: "WAITING", at: 0 }, 1_000, 120)).toBeNull();
  });

  it("normalizes phone numbers for hashing", async () => {
    const { normalizePhone } = await import("@/domain/tickets/phone");
    expect(normalizePhone("٠٥٠ ١٢٣ ٤٥٦٧")).toBe("0501234567");
    expect(normalizePhone("00966-50-123-4567")).toBe("+966501234567");
    expect(normalizePhone("abc")).toBeNull();
  });
});
