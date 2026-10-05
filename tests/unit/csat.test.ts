import { describe, expect, it } from "vitest";
import { averageScore, cleanComment, npsOf, satisfiedPct, summarizeCsat, type FeedbackFact } from "@/domain/feedback/csat";
import { computeReport } from "@/domain/reports/compute";
import type { ReportInput, TicketFact } from "@/domain/reports/types";
import { zonedToUtc } from "@/domain/schedule/time";
import { computeProgress } from "@/domain/profile/progress";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

const TZ = "Asia/Damascus";
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm, TZ);
const MIN = 60_000;

describe("CSAT arithmetic", () => {
  it("averages, satisfied share and distribution", () => {
    const facts = [5, 4, 4, 2, 1].map((score) => ({ score, nps: null }));
    expect(averageScore([5, 4, 4, 2, 1])).toBe(3.2);
    expect(satisfiedPct([5, 4, 4, 2, 1])).toBe(60);
    const s = summarizeCsat(facts, 10);
    expect(s).toMatchObject({ responses: 5, avg: 3.2, satisfiedPct: 60, responseRatePct: 50, eligible: 10, nps: null });
    expect(s.distribution).toEqual([
      { score: 1, count: 1 },
      { score: 2, count: 1 },
      { score: 3, count: 0 },
      { score: 4, count: 2 },
      { score: 5, count: 1 },
    ]);
  });

  it("is empty-safe", () => {
    const s = summarizeCsat([], 0);
    expect(s).toMatchObject({ responses: 0, avg: null, satisfiedPct: 0, responseRatePct: 0, nps: null });
    expect(s.distribution.every((d) => d.count === 0)).toBe(true);
    expect(averageScore([])).toBeNull();
  });

  it("caps the response rate at 100", () => {
    expect(summarizeCsat([{ score: 5, nps: null }], 0).responseRatePct).toBe(0);
    expect(
      summarizeCsat(
        [
          { score: 5, nps: null },
          { score: 5, nps: null },
        ],
        1,
      ).responseRatePct,
    ).toBe(100);
  });

  it("NPS is promoters minus detractors", () => {
    // 10, 9 promoters; 8, 7 passives; 6, 0 detractors.
    const n = npsOf([10, 9, 8, 7, 6, 0])!;
    expect(n).toMatchObject({ responses: 6, score: 0, promotersPct: 33.3, detractorsPct: 33.3, passivesPct: 33.3 });
    expect(npsOf([10, 10, 9, 3])!.score).toBe(50);
    expect(npsOf([])).toBeNull();
  });

  it("trims comments and turns blanks into nothing", () => {
    expect(cleanComment("  good   service \n")).toBe("good service");
    expect(cleanComment("   ")).toBeNull();
    expect(cleanComment(null)).toBeNull();
  });
});

let n = 0;
function done(arrive: string, over: Partial<TicketFact> = {}): TicketFact {
  const arrivedAt = at("2026-09-29", arrive);
  return {
    id: `t${++n}`,
    branchId: "b1",
    reasonId: "r1",
    agentId: "a1",
    arrivedAt,
    firstCalledAt: arrivedAt + 2 * MIN,
    startedAt: arrivedAt + 2 * MIN,
    finishedAt: arrivedAt + 10 * MIN,
    status: "COMPLETED",
    recalls: 0,
    transfersOut: [],
    returning: false,
    visitorId: null,
    slaTargetMinutes: 10,
    ...over,
  };
}
const fb = (ticket: TicketFact, score: number, over: Partial<FeedbackFact> = {}): FeedbackFact => ({
  id: `f${ticket.id}`,
  ticketId: ticket.id,
  score,
  nps: null,
  comment: null,
  at: ticket.finishedAt! + MIN,
  displayNumber: `A-${ticket.id}`,
  ...over,
});
const input = (facts: TicketFact[], feedback: FeedbackFact[]): ReportInput => ({
  facts,
  statusLog: [],
  branches: new Map([["b1", { name: { ar: "الرئيسي" }, timezone: TZ }]]),
  reasons: new Map([
    ["r1", { name: { ar: "عام" }, color: "#0f766e" }],
    ["r2", { name: { ar: "شكوى" }, color: "#b45309" }],
  ]),
  agents: new Map([
    ["a1", { name: { ar: "خالد" } }],
    ["a2", { name: { ar: "نورة" } }],
  ]),
  fromMs: at("2026-09-29", "00:00"),
  toMs: at("2026-09-30", "00:00"),
  now: at("2026-09-30", "00:00"),
  serviceLevel: { minutes: 5, targetPct: 80 },
  feedback,
  lowScoreThreshold: 2,
});

describe("CSAT in the report", () => {
  it("summarises answers and splits them by agent, reason and day", () => {
    const a = done("09:00");
    const b = done("10:00", { agentId: "a2", reasonId: "r2" });
    const c = done("11:00");
    const open = done("12:00", { status: "WAITING", finishedAt: null, firstCalledAt: null, startedAt: null });
    const { csat, agents } = computeReport(
      input(
        [a, b, c, open],
        [fb(a, 5), fb(b, 1, { comment: "slow", nps: 3 }), fb(c, 4, { nps: 10 }), { ...fb(a, 1), ticketId: "elsewhere" }],
      ),
    );
    expect(csat.summary).toMatchObject({ responses: 3, avg: 3.33, satisfiedPct: 66.7, eligible: 3, responseRatePct: 100 });
    expect(csat.summary.nps).toMatchObject({ responses: 2, score: 0 });
    expect(csat.byAgent.find((g) => g.key === "a1")).toMatchObject({ responses: 2, avg: 4.5, satisfiedPct: 100 });
    expect(csat.byAgent.find((g) => g.key === "a2")).toMatchObject({ responses: 1, avg: 1, satisfiedPct: 0 });
    expect(csat.byReason.find((g) => g.key === "r2")?.name).toEqual({ ar: "شكوى" });
    expect(csat.byDay).toEqual([{ date: "2026-09-29", responses: 3, avg: 3.33 }]);
    expect(csat.lowComments).toHaveLength(1);
    expect(csat.lowComments[0]).toMatchObject({ score: 1, comment: "slow", agentId: "a2", displayNumber: expect.any(String) });
    // The agents table carries the average too.
    expect(agents.find((x) => x.agentId === "a1")).toMatchObject({ csatAvg: 4.5, csatResponses: 2 });
    expect(agents.find((x) => x.agentId === "a2")).toMatchObject({ csatAvg: 1, csatResponses: 1 });
  });

  it("is empty when nobody answered", () => {
    const { csat, agents } = computeReport(input([done("09:00")], []));
    expect(csat.summary).toMatchObject({ responses: 0, avg: null, eligible: 1, responseRatePct: 0 });
    expect(csat.byAgent).toEqual([]);
    expect(csat.lowComments).toEqual([]);
    expect(agents[0]).toMatchObject({ csatAvg: null, csatResponses: 0 });
  });

  it("lists only comments at or below the low-score limit", () => {
    const a = done("09:00");
    const b = done("10:00");
    const c = done("11:00");
    const { csat } = computeReport({
      ...input([a, b, c], [fb(a, 3, { comment: "ok" }), fb(b, 2, { comment: "meh" }), fb(c, 1)]),
      lowScoreThreshold: 3,
    });
    expect(csat.lowComments.map((x) => x.comment).sort()).toEqual(["meh", "ok"]);
  });
});

describe("CSAT on the profile", () => {
  const now = at("2026-09-29", "12:00");
  const own = (score: number, minutesAgo: number, comment: string | null = null) => ({
    agentId: "me",
    score,
    comment,
    at: now - minutesAgo * MIN,
  });
  it("gives the agent their average, the branch average and recent comments", () => {
    const p = computeProgress({
      now,
      timezone: TZ,
      period: "week",
      actionsDaily: [],
      agent: {
        facts: [],
        branchFacts: null,
        statusLog: [],
        servedDaily: [],
        branchActiveDays: [],
        feedback: {
          own: [own(5, 30, "kind"), own(3, 60)],
          branch: [own(5, 30), own(3, 60), { agentId: "other", score: 1, comment: null, at: now - 10 * MIN }],
        },
      },
    });
    const c = p.agent!.csat!;
    expect(c.periods.day.current).toMatchObject({ avg: 4, responses: 2, satisfiedPct: 50 });
    expect(c.periods.day.branchAvg).toBe(3);
    expect(c.trend).toHaveLength(14);
    expect(c.trend.at(-1)).toEqual({ date: "2026-09-29", avg: 4, responses: 2 });
    expect(c.recent).toEqual([{ at: now - 30 * MIN, score: 5, comment: "kind", displayNumber: null }]);
  });
  it("has no CSAT block when feedback is off", () => {
    const p = computeProgress({
      now,
      timezone: TZ,
      period: "day",
      actionsDaily: [],
      agent: { facts: [], branchFacts: null, statusLog: [], servedDaily: [], branchActiveDays: [] },
    });
    expect(p.agent!.csat).toBeNull();
  });
});

describe("feedback settings", () => {
  it("defaults are on, faces, comment asked, NPS off, low score 2", () => {
    expect(defaultSetting("feedback")).toMatchObject({
      enabled: true,
      style: "faces",
      askComment: true,
      askNps: false,
      lowScoreThreshold: 2,
      showOnStatusPage: true,
    });
    expect(defaultSetting("feedback").prompt.ar).toBeTruthy();
    expect(defaultSetting("feedback").thanks.en).toBeTruthy();
    expect(parseSetting("feedback", { lowScoreThreshold: 9 }).lowScoreThreshold).toBe(2);
    expect(defaultSetting("wallboard").showCsat).toBe(true);
    expect(defaultSetting("alerts")).toMatchObject({ lowScoreAlerts: true, lowSatisfactionBelow: 0 });
  });
});
