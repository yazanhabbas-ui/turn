import { describe, expect, it } from "vitest";
import { computeAgentReport, presetRange } from "@/domain/profile/agent-report";
import { computeProgress } from "@/domain/profile/progress";
import { computeReport } from "@/domain/reports/compute";
import { computeHallReport, hostedSummary, type HallInfo, type HallSessionFact } from "@/domain/reports/halls";
import { EXPORT_SECTIONS, parseSections } from "@/domain/reports/sections";
import type { ReportInput } from "@/domain/reports/types";
import { renderMessage } from "@/domain/notifications/policy";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 29, 6, 0);

const halls = new Map<string, HallInfo>([
  ["h1", { number: "1", name: { ar: "القاعة أ", en: "Hall A" }, branchId: "b1" }],
  ["h2", { number: "2", name: { ar: "القاعة ب", en: "Hall B" }, branchId: "b1" }],
]);

const session = (
  over: Partial<HallSessionFact> & Pick<HallSessionFact, "sessionId" | "hallId" | "members">,
): HallSessionFact => ({
  branchId: "b1",
  hostAgentId: "a1",
  status: "CLOSED",
  capacity: 10,
  calledAt: T0,
  startedAt: T0 + 2 * MIN,
  closedAt: T0 + 32 * MIN,
  ...over,
});

describe("computeHallReport", () => {
  it("counts held sessions, group size, occupancy, length and no-show rate per hall", () => {
    const rows = computeHallReport(
      [
        session({ sessionId: "s1", hallId: "h1", capacity: 10, members: ["DONE", "DONE", "DONE", "NO_SHOW"] }),
        session({
          sessionId: "s2",
          hallId: "h1",
          capacity: 5,
          startedAt: T0 + 60 * MIN,
          closedAt: T0 + 80 * MIN,
          members: ["DONE", "DONE", "DONE", "DONE", "DONE"],
        }),
        session({ sessionId: "s3", hallId: "h2", capacity: 4, members: ["DONE", "DONE"] }),
      ],
      halls,
    );
    expect(rows.map((r) => r.hallId)).toEqual(["h1", "h2"]);
    const [h1, h2] = rows;
    expect(h1).toMatchObject({ sessions: 2, visitors: 8, avgGroupSize: 4, called: 9, noShow: 1, noShowRatePct: 11.1 });
    // 3/10 = 30% and 5/5 = 100%: the average of the two sessions
    expect(h1.occupancyPct).toBe(65);
    expect(h1.avgSessionMin).toBe(25);
    expect(h2).toMatchObject({ sessions: 1, avgGroupSize: 2, occupancyPct: 50, avgSessionMin: 30, noShowRatePct: 0 });
    expect(h1.number).toBe("1");
  });

  it("ignores sessions that did not take place and skips halls without any", () => {
    const rows = computeHallReport(
      [
        session({ sessionId: "s1", hallId: "h1", status: "CANCELLED", startedAt: null, closedAt: null, members: ["RELEASED"] }),
        session({ sessionId: "s2", hallId: "h1", status: "OPEN", startedAt: null, closedAt: null, members: ["CALLED"] }),
      ],
      halls,
    );
    expect(rows).toEqual([]);
  });

  it("a session where nobody came is a no-show session, not a held one", () => {
    const [h1] = computeHallReport(
      [session({ sessionId: "s1", hallId: "h1", startedAt: null, members: ["NO_SHOW", "NO_SHOW"] })],
      halls,
    );
    expect(h1).toMatchObject({ sessions: 0, visitors: 0, avgGroupSize: 0, occupancyPct: 0, noShow: 2, noShowRatePct: 100 });
  });

  it("released visitors count as called but not as no-show or as received", () => {
    const [h1] = computeHallReport(
      [session({ sessionId: "s1", hallId: "h1", capacity: 4, members: ["DONE", "RELEASED", "ENTERED"] })],
      halls,
    );
    expect(h1).toMatchObject({ sessions: 1, visitors: 2, called: 3, noShow: 0, occupancyPct: 50 });
  });

  it("sums hosting per agent", () => {
    const list = [
      session({ sessionId: "s1", hallId: "h1", members: ["DONE", "DONE", "NO_SHOW"] }),
      session({ sessionId: "s2", hallId: "h1", hostAgentId: "a2", members: ["DONE"] }),
      session({ sessionId: "s3", hallId: "h1", members: ["DONE"], status: "CANCELLED" }),
    ];
    expect(hostedSummary(list, "a1")).toEqual({ sessions: 1, visitors: 2 });
    expect(hostedSummary(list, "nobody")).toEqual({ sessions: 0, visitors: 0 });
  });
});

describe("byHall in the report", () => {
  const base: ReportInput = {
    facts: [],
    statusLog: [],
    branches: new Map(),
    reasons: new Map(),
    agents: new Map(),
    fromMs: T0 - 60 * MIN,
    toMs: T0 + 600 * MIN,
    now: T0 + 600 * MIN,
    serviceLevel: { minutes: 15, targetPct: 80 },
  };

  it("is empty without hall data and filled when sessions are passed", () => {
    expect(computeReport(base).byHall).toEqual([]);
    const data = computeReport({
      ...base,
      halls,
      hallSessions: [session({ sessionId: "s1", hallId: "h1", members: ["DONE", "DONE"] })],
    });
    expect(data.byHall).toHaveLength(1);
    expect(data.byHall[0]).toMatchObject({ hallId: "h1", sessions: 1, visitors: 2 });
  });

  it("is an export section that can be requested by name", () => {
    expect(EXPORT_SECTIONS).toContain("byHall");
    expect(parseSections("byHall,summary")).toEqual(["summary", "byHall"]);
  });
});

describe("hall hosting in the agent's own numbers", () => {
  it("the agent report carries the hosting totals only when there were sessions", () => {
    const range = presetRange("day", T0, "Asia/Damascus");
    const input = { range, timezone: "Asia/Damascus", facts: [], previousFacts: [], branchFacts: null, feedbackOn: false };
    expect(computeAgentReport(input).halls).toBeUndefined();
    expect(computeAgentReport({ ...input, hosted: { sessions: 0, visitors: 0 } }).halls).toBeUndefined();
    expect(computeAgentReport({ ...input, hosted: { sessions: 2, visitors: 9 } }).halls).toEqual({ sessions: 2, visitors: 9 });
  });

  it("progress shows hosting per period only when something was hosted", () => {
    const now = T0 + 5 * 60 * MIN;
    const agent = {
      facts: [],
      branchFacts: null,
      statusLog: [],
      servedDaily: [],
      branchActiveDays: [],
    };
    const none = computeProgress({ now, timezone: "Asia/Damascus", period: "week", agent, actionsDaily: [] });
    expect(none.agent?.hosted).toBeUndefined();
    const some = computeProgress({
      now,
      timezone: "Asia/Damascus",
      period: "week",
      agent: {
        ...agent,
        hosted: [
          { closedAt: now - 60 * MIN, visitors: 6 },
          { closedAt: now - 30 * MIN, visitors: 4 },
        ],
      },
      actionsDaily: [],
    });
    expect(some.agent?.hosted?.day).toEqual({ sessions: 2, visitors: 10 });
    expect(some.agent?.hosted?.month.sessions).toBe(2);
  });
});

describe("the {hall} message line", () => {
  const body = "Number {number}.\nPlease go to desk {desk}.\nYour group is called: please go to hall {hall}.";
  it("a desk visit gets the desk line only, a group visit the hall line only", () => {
    expect(renderMessage(body, { number: "A-1", desk: "3", hall: "" })).toBe("Number A-1.\nPlease go to desk 3.");
    expect(renderMessage(body, { number: "H-1", desk: "", hall: "2 Hall B" })).toBe(
      "Number H-1.\nYour group is called: please go to hall 2 Hall B.",
    );
  });
});
