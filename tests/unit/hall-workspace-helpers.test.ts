import { describe, expect, it } from "vitest";
import { clampGroupSize, MEMBER_STATUS, noCallReason, sessionFlags, stepperMax, workMode } from "@/features/agent/hall-helpers";
import type { HallConsole, HallSession } from "@/features/queue/types";

const settings = { groupMode: "any_reason", minGroup: 2, maxGroup: 0, allowTopUp: true, autoStartWhenAllEntered: true } as const;
const member = (status: HallSession["tickets"][number]["status"]) => ({ status }) as HallSession["tickets"][number];
const consoleOf = (over: Partial<HallConsole>, statuses?: HallSession["tickets"][number]["status"][], sessionStatus = "OPEN") =>
  ({
    settings,
    waiting: 0,
    callable: 0,
    maxCall: 8,
    session: statuses ? ({ status: sessionStatus, tickets: statuses.map(member) } as HallSession) : null,
    ...over,
  }) as HallConsole;

describe("hall workspace helpers", () => {
  it("clamps the group size between 1 and the most that can be called", () => {
    expect(clampGroupSize(5, 8)).toBe(5);
    expect(clampGroupSize(0, 8)).toBe(1);
    expect(clampGroupSize(20, 8)).toBe(8);
    expect(clampGroupSize(3.7, 8)).toBe(3);
    expect(clampGroupSize(3, 0)).toBe(0);
    expect(clampGroupSize(Number.NaN, 4)).toBe(4);
  });

  it("offers at most what can be called now", () => {
    expect(stepperMax(8, 5)).toBe(5);
    expect(stepperMax(3, 5)).toBe(3);
    expect(stepperMax(8, 0)).toBe(8);
    expect(stepperMax(0, 5)).toBe(0);
  });

  it("explains why nobody can be called", () => {
    expect(noCallReason({ waiting: 4, callable: 4, maxCall: 8 })).toBeNull();
    expect(noCallReason({ waiting: 0, callable: 0, maxCall: 8 })).toBe("waiting_empty");
    expect(noCallReason({ waiting: 1, callable: 0, maxCall: 8 })).toBe("below_min");
    expect(noCallReason({ waiting: 3, callable: 0, maxCall: 0 })).toBe("full");
  });

  it("maps every member status to a message key", () => {
    expect(Object.values(MEMBER_STATUS).map((x) => x.key)).toEqual(["called", "entered", "done", "noShow", "released"]);
  });

  it("derives the group buttons from the session", () => {
    const calledOnly = sessionFlags(consoleOf({ waiting: 3, callable: 3 }, ["CALLED", "CALLED"]));
    expect(calledOnly).toMatchObject({
      canEnterAll: true,
      startEnabled: false,
      canClose: false,
      canCancel: true,
      canTopUp: true,
    });
    const mixed = sessionFlags(consoleOf({}, ["ENTERED", "CALLED"]));
    expect(mixed).toMatchObject({ canEnterAll: true, startEnabled: true, canClose: true, canCancel: false, canTopUp: false });
    const running = sessionFlags(consoleOf({ waiting: 5, callable: 5 }, ["ENTERED", "ENTERED"], "IN_SESSION"));
    expect(running).toMatchObject({ canStart: false, canTopUp: false, canClose: true, canRecall: false });
    expect(
      sessionFlags(consoleOf({ settings: { ...settings, allowTopUp: false }, waiting: 3, callable: 3 }, ["CALLED"])).canTopUp,
    ).toBe(false);
    expect(sessionFlags(consoleOf({}, undefined))).toMatchObject({ canClose: false, canCancel: false, canEnterAll: false });
  });

  it("chooses desk or hall mode", () => {
    const p = { currentDeskId: null, currentHallId: null, defaultDeskId: null, defaultHallId: null };
    expect(workMode(p, false)).toBe("desk");
    expect(workMode({ ...p, currentHallId: "h" }, true)).toBe("hall");
    expect(workMode({ ...p, currentDeskId: "d", defaultHallId: "h" }, true)).toBe("desk");
    expect(workMode({ ...p, defaultHallId: "h" }, true)).toBe("hall");
    expect(workMode({ ...p, defaultHallId: "h", defaultDeskId: "d" }, true)).toBe("desk");
    expect(workMode(undefined, true)).toBe("desk");
  });
});
