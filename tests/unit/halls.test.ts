import { describe, expect, it } from "vitest";
import { dispatch, selectAgentForTicket, selectTicketForAgent } from "@/domain/distribution/engine";
import { estimateHallWait, estimateWait } from "@/domain/distribution/estimate";
import { consecutiveRuns, planGroupAnnouncement } from "@/domain/halls/announce";
import { planHallBatch, seatsLeft } from "@/domain/halls/plan";
import { memberStatusFor, nextSessionStatus, occupancyPct } from "@/domain/halls/state";
import { agent, min, snapshot, ticket } from "./engine-helpers";

const w = (id: string, reasonId = "r1") => ({ id, reasonId });

describe("planHallBatch", () => {
  it("takes the first visitors in queue order up to the capacity", () => {
    const waiting = ["a", "b", "c", "d", "e"].map((id) => w(id));
    expect(planHallBatch({ waiting, capacity: 3, minGroup: 1, maxGroup: 0 }).ticketIds).toEqual(["a", "b", "c"]);
  });

  it("respects the maximum group, the host's size and the seats already taken", () => {
    const waiting = ["a", "b", "c", "d", "e"].map((id) => w(id));
    expect(planHallBatch({ waiting, capacity: 10, minGroup: 1, maxGroup: 2 }).ticketIds).toEqual(["a", "b"]);
    expect(planHallBatch({ waiting, capacity: 10, minGroup: 1, maxGroup: 0, size: 4 }).ticketIds).toHaveLength(4);
    expect(planHallBatch({ waiting, capacity: 10, minGroup: 1, maxGroup: 0, size: 99 }).ticketIds).toHaveLength(5);
    // top-up: 3 inside a hall of 4 leaves one seat
    expect(planHallBatch({ waiting, capacity: 4, minGroup: 1, maxGroup: 0, occupied: 3 }).ticketIds).toEqual(["a"]);
    expect(seatsLeft(8, 5, 3)).toBe(2);
    expect(seatsLeft(8, 0, 8)).toBe(0);
  });

  it("reports a full hall and an empty line", () => {
    expect(planHallBatch({ waiting: [w("a")], capacity: 2, minGroup: 1, maxGroup: 0, occupied: 2 }).shortfall).toBe("full");
    expect(planHallBatch({ waiting: [], capacity: 2, minGroup: 1, maxGroup: 0 })).toMatchObject({
      ticketIds: [],
      shortfall: "empty",
    });
  });

  it("does not open a session below the minimum group, but a top-up ignores the minimum", () => {
    const waiting = [w("a"), w("b")];
    expect(planHallBatch({ waiting, capacity: 8, minGroup: 3, maxGroup: 0 })).toMatchObject({
      ticketIds: [],
      shortfall: "below_min",
      available: 2,
    });
    expect(planHallBatch({ waiting, capacity: 8, minGroup: 3, maxGroup: 0, occupied: 4 }).ticketIds).toEqual(["a", "b"]);
    // a minimum above the capacity is capped by what fits
    expect(planHallBatch({ waiting, capacity: 2, minGroup: 5, maxGroup: 0 }).ticketIds).toEqual(["a", "b"]);
  });

  it("same_reason: one reason per session, the head of the line first", () => {
    const waiting = [w("a", "x"), w("b", "y"), w("c", "x"), w("d", "y"), w("e", "y")];
    const p = planHallBatch({ waiting, capacity: 8, minGroup: 1, maxGroup: 0, groupMode: "same_reason" });
    expect(p.reasonId).toBe("x");
    expect(p.ticketIds).toEqual(["a", "c"]);
  });

  it("same_reason: skips a head-of-line reason that cannot fill the minimum", () => {
    const waiting = [w("a", "x"), w("b", "y"), w("c", "y")];
    const p = planHallBatch({ waiting, capacity: 8, minGroup: 2, maxGroup: 0 });
    expect(p.reasonId).toBe("y");
    expect(p.ticketIds).toEqual(["b", "c"]);
  });

  it("same_reason: an explicit reason (host choice, or the session's reason on top-up) wins", () => {
    const waiting = [w("a", "x"), w("b", "y")];
    expect(planHallBatch({ waiting, capacity: 8, minGroup: 1, maxGroup: 0, reasonId: "y" }).ticketIds).toEqual(["b"]);
  });

  it("any_reason: first come first served across reasons", () => {
    const waiting = [w("a", "x"), w("b", "y"), w("c", "x")];
    const p = planHallBatch({ waiting, capacity: 2, minGroup: 1, maxGroup: 0, groupMode: "any_reason" });
    expect(p.ticketIds).toEqual(["a", "b"]);
    expect(p.reasonId).toBeNull();
  });

  it("only takes the reasons the hall accepts", () => {
    const waiting = [w("a", "x"), w("b", "y"), w("c", "y")];
    const p = planHallBatch({
      waiting,
      capacity: 8,
      minGroup: 1,
      maxGroup: 0,
      acceptedReasonIds: ["y"],
      groupMode: "any_reason",
    });
    expect(p.ticketIds).toEqual(["b", "c"]);
    // an empty list accepts everything
    expect(
      planHallBatch({ waiting, capacity: 8, minGroup: 1, maxGroup: 0, acceptedReasonIds: [], groupMode: "any_reason" }).ticketIds,
    ).toHaveLength(3);
  });
});

describe("hall state mapping", () => {
  it("maps ticket statuses to the member status", () => {
    expect(memberStatusFor("CALLED")).toBe("CALLED");
    expect(memberStatusFor("SERVING")).toBe("ENTERED");
    expect(memberStatusFor("COMPLETED")).toBe("DONE");
    expect(memberStatusFor("NO_SHOW")).toBe("NO_SHOW");
    for (const s of ["WAITING", "ON_HOLD", "CANCELLED"] as const) expect(memberStatusFor(s)).toBe("RELEASED");
  });

  it("starts by itself when everybody entered, closes when nobody is left", () => {
    const open = { status: "OPEN" as const, started: false };
    expect(nextSessionStatus(open, [{ status: "ENTERED" }, { status: "CALLED" }], true)).toBe("OPEN");
    expect(nextSessionStatus(open, [{ status: "ENTERED" }, { status: "ENTERED" }], true)).toBe("IN_SESSION");
    expect(nextSessionStatus(open, [{ status: "ENTERED" }, { status: "ENTERED" }], false)).toBe("OPEN");
    // a visitor who never came does not hold the start back once the others are in
    expect(nextSessionStatus(open, [{ status: "ENTERED" }, { status: "NO_SHOW" }], true)).toBe("IN_SESSION");
    expect(nextSessionStatus({ status: "IN_SESSION", started: true }, [{ status: "DONE" }, { status: "DONE" }], true)).toBe(
      "CLOSED",
    );
    expect(nextSessionStatus(open, [{ status: "RELEASED" }, { status: "RELEASED" }], true)).toBe("CANCELLED");
    expect(nextSessionStatus(open, [{ status: "NO_SHOW" }, { status: "NO_SHOW" }], true)).toBe("CLOSED");
    expect(nextSessionStatus({ status: "CLOSED", started: true }, [], true)).toBe("CLOSED");
  });

  it("computes occupancy", () => {
    expect(occupancyPct(3, 8)).toBe(38);
    expect(occupancyPct(0, 0)).toBe(0);
  });
});

describe("wait estimate for hall reasons", () => {
  const cfg = { rounding: 1, bufferPercent: 0 };
  it("is ceil(ahead / capacity) sessions of the session length", () => {
    expect(estimateHallWait(0, 8, 1, 30, cfg).minutes).toBe(0);
    expect(estimateHallWait(1, 8, 1, 30, cfg).minutes).toBe(30);
    expect(estimateHallWait(8, 8, 1, 30, cfg).minutes).toBe(30);
    expect(estimateHallWait(9, 8, 1, 30, cfg).minutes).toBe(60);
    expect(estimateHallWait(20, 8, 1, 30, cfg).minutes).toBe(90);
  });

  it("shares the sessions between halls that work in parallel", () => {
    expect(estimateHallWait(20, 8, 2, 30, cfg).minutes).toBe(60);
    expect(estimateHallWait(20, 8, 3, 30, cfg).minutes).toBe(30);
  });

  it("applies the same rounding and buffer as the desk estimate and keeps a range", () => {
    const e = estimateHallWait(9, 8, 1, { minutes: 30, low: 20, high: 40 }, { rounding: 5, bufferPercent: 10 });
    expect(e).toEqual(
      estimateWait(2, 1, { minutes: 30, low: 20, high: 40 }, { divideByAgents: false, rounding: 5, bufferPercent: 10 }),
    );
    expect(e.low).toBeLessThanOrEqual(e.minutes);
    expect(e.high).toBeGreaterThanOrEqual(e.minutes);
  });
});

describe("group announcement plan", () => {
  it("lists up to the limit, then falls back to ranges", () => {
    const three = ["A-014", "A-015", "A-016"];
    expect(planGroupAnnouncement(three, "list", 6)).toMatchObject({ mode: "list", total: 3 });
    const nine = Array.from({ length: 9 }, (_, i) => `A-${String(i + 10).padStart(3, "0")}`);
    const r = planGroupAnnouncement(nine, "list", 6);
    expect(r.mode).toBe("range");
    expect(r.items).toEqual([{ kind: "range", from: "A-010", to: "A-018", count: 9 }]);
  });

  it("range mode joins consecutive numbers of one prefix and keeps the others as they are", () => {
    const r = planGroupAnnouncement(["A-014", "A-015", "A-016", "B-003", "A-020"], "range", 6);
    expect(r.items).toEqual([
      { kind: "range", from: "A-014", to: "A-016", count: 3 },
      { kind: "ticket", displayNumber: "A-020" },
      { kind: "ticket", displayNumber: "B-003" },
    ]);
  });

  it("hall_only reads no numbers; a single visitor is always read by number; long scattered lists fall back to the group", () => {
    expect(planGroupAnnouncement(["A-001", "A-002"], "hall_only", 6)).toMatchObject({ mode: "group_only", items: [] });
    expect(planGroupAnnouncement(["A-001"], "range", 6)).toMatchObject({ mode: "list", items: [{ kind: "ticket" }] });
    const scattered = ["A-001", "A-003", "A-005", "A-007", "A-009", "A-011", "A-013", "A-015"];
    expect(planGroupAnnouncement(scattered, "list", 6).mode).toBe("group_only");
  });

  it("finds runs per prefix", () => {
    expect(consecutiveRuns(["A-001", "A-002", "B-001", "A-004"])).toEqual([["A-001", "A-002"], ["A-004"], ["B-001"]]);
  });
});

describe("hall tickets stay out of the desk distribution", () => {
  it("are never reserved by dispatch, whatever the mode", () => {
    const s = snapshot({
      config: { mode: "push" },
      tickets: [ticket({ id: "h1", hall: true }), ticket({ id: "d1" })],
      agents: [agent("a1"), agent("a2")],
    });
    const out = dispatch(s);
    expect(out.map((x) => x.ticketId)).toEqual(["d1"]);
    expect(selectAgentForTicket(s, s.tickets[0])).toBeNull();
  });

  it("are never handed to an agent calling next", () => {
    const s = snapshot({
      tickets: [ticket({ id: "h1", hall: true, queuedAt: 0 }), ticket({ id: "d1", queuedAt: min(1) })],
      agents: [agent("a1")],
    });
    expect(selectTicketForAgent(s, "a1")).toMatchObject({ ticket: { id: "d1" } });
    const onlyHall = snapshot({ tickets: [ticket({ id: "h1", hall: true })], agents: [agent("a1")] });
    expect(selectTicketForAgent(onlyHall, "a1")).toMatchObject({ ticket: null, reason: "empty" });
  });

  it("an agent hosting a hall gets no desk work", () => {
    const s = snapshot({ config: { mode: "push" }, tickets: [ticket({ id: "d1" })], agents: [agent("host", { inHall: true })] });
    expect(dispatch(s)).toEqual([]);
    expect(selectTicketForAgent(s, "host")).toMatchObject({ ticket: null, reason: "not_working" });
  });
});
