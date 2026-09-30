import { describe, expect, it } from "vitest";
import { agentTimes, computeForecast, computeReport, fairnessIndex, percentile } from "@/domain/reports/compute";
import type { ReportInput, TicketFact } from "@/domain/reports/types";
import { zonedToUtc } from "@/domain/schedule/time";

const TZ = "Asia/Damascus";
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm, TZ);
const MIN = 60_000;

let n = 0;
function fact(over: Partial<TicketFact> & { arrive: string; date?: string }): TicketFact {
  const { arrive, date = "2026-09-29", ...rest } = over;
  const arrivedAt = at(date, arrive);
  return {
    id: `t${++n}`,
    branchId: "b1",
    reasonId: "r1",
    agentId: "a1",
    arrivedAt,
    firstCalledAt: null,
    startedAt: null,
    finishedAt: null,
    status: "WAITING",
    recalls: 0,
    transfersOut: [],
    returning: false,
    visitorId: null,
    slaTargetMinutes: 10,
    ...rest,
  };
}

/** A served ticket: waits `wait` min, then is served `svc` min. */
function served(arrive: string, wait: number, svc: number, over: Partial<TicketFact> = {}, date = "2026-09-29"): TicketFact {
  const arrivedAt = at(date, arrive);
  return fact({
    arrive,
    date,
    firstCalledAt: arrivedAt + wait * MIN,
    startedAt: arrivedAt + wait * MIN,
    finishedAt: arrivedAt + (wait + svc) * MIN,
    status: "COMPLETED",
    ...over,
  });
}

const base = (facts: TicketFact[], extra: Partial<ReportInput> = {}): ReportInput => ({
  facts,
  statusLog: [],
  branches: new Map([["b1", { name: { ar: "الرئيسي" }, timezone: TZ }]]),
  reasons: new Map([["r1", { name: { ar: "عام" }, color: "#0f766e" }]]),
  agents: new Map([
    ["a1", { name: { ar: "خالد" } }],
    ["a2", { name: { ar: "نورة" } }],
  ]),
  fromMs: at("2026-09-29", "00:00"),
  toMs: at("2026-09-30", "00:00"),
  now: at("2026-09-30", "00:00"),
  serviceLevel: { minutes: 5, targetPct: 80 },
  ...extra,
});

describe("statistics helpers", () => {
  it("percentile interpolates", () => {
    expect(percentile([], 90)).toBe(0);
    expect(percentile([10], 90)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([0, 10], 90)).toBe(9);
  });
  it("Jain's fairness index: equal work = 1, all on one agent = 1/n", () => {
    expect(fairnessIndex([5, 5, 5])).toBe(1);
    expect(fairnessIndex([9, 0, 0])).toBeCloseTo(0.333, 3);
    expect(fairnessIndex([])).toBe(1);
  });
});

describe("report summary", () => {
  const facts = [
    served("09:00", 2, 10),
    served("09:10", 4, 6),
    served("10:00", 12, 8, { recalls: 1 }), // breaches the 10-minute SLA and the 5-minute service level
    fact({ arrive: "10:30", firstCalledAt: at("2026-09-29", "10:40"), status: "NO_SHOW", finishedAt: at("2026-09-29", "10:45") }),
    fact({ arrive: "11:00", status: "CANCELLED", finishedAt: at("2026-09-29", "11:06") }),
    fact({ arrive: "11:30", status: "WAITING" }),
    served("13:00", 1, 5, { returning: true, transfersOut: ["a2"] }),
  ];
  const r = computeReport(base(facts));
  const s = r.summary;

  it("counts visitors by outcome", () => {
    expect(s).toMatchObject({ visitors: 7, served: 4, noShow: 1, cancelled: 1, stillOpen: 1, transferred: 1 });
  });

  it("waiting time is arrival to first call, over called tickets", () => {
    // waits: 2, 4, 12, 10 (no-show was called after 10), 1
    expect(s.wait.avg).toBe(5.8);
    expect(s.wait.median).toBe(4);
    expect(s.wait.max).toBe(12);
  });

  it("service time is start to finish of completed tickets", () => {
    expect(s.service.avg).toBe(7.3); // 10, 6, 8, 5
    expect(s.service.max).toBe(10);
  });

  it("SLA compliance and service level", () => {
    // called = 5; within 10 min SLA: 2,4,1 = 3 (12 and 10? 10 <= 10 counts) -> 4
    expect(s.slaPct).toBe(80);
    expect(s.serviceLevel).toMatchObject({ minutes: 5, targetPct: 80, pct: 60 }); // 2,4,1 within 5 of 5
  });

  it("abandonment rate and average wait before abandoning", () => {
    expect(s.abandonmentPct).toBe(28.6); // 2 of 7
    expect(s.avgWaitBeforeAbandonMin).toBe(8); // no-show 10 + cancelled 6
  });

  it("recall, transfer and returning rates", () => {
    expect(s.recallRatePct).toBe(20); // 1 of 5 called
    expect(s.transferRatePct).toBe(14.3);
    expect(s.returningPct).toBe(14.3);
    expect(s.firstVisitPct).toBe(85.7);
  });

  it("buckets by hour, weekday and day in the branch time zone", () => {
    expect(r.byHour[9].visitors).toBe(2);
    expect(r.byHour[10].visitors).toBe(2);
    expect(r.byWeekday[2].visitors).toBe(7); // 29 Sep 2026 is a Tuesday
    expect(r.byDay).toEqual([{ date: "2026-09-29", visitors: 7, served: 4, avgWaitMin: 5.8 }]);
    expect(r.heatmap.cells).toContainEqual([2, 9, 2]);
    expect(r.heatmap.max).toBe(2);
    expect(r.backlogByDay).toEqual([{ date: "2026-09-29", count: 1 }]);
  });

  it("per reason figures", () => {
    expect(r.byReason).toHaveLength(1);
    expect(r.byReason[0]).toMatchObject({ visitors: 7, served: 4, slaPct: 80 });
  });

  it("queue length peaks while people wait", () => {
    // From 10:00 to 10:12 the third ticket waits; at 09:00 it's just the first arrival.
    expect(r.queueLengthByHour[10].max).toBeGreaterThanOrEqual(1);
    expect(r.queueLengthByHour[3].avg).toBe(0);
    // The ticket still WAITING at 11:30 stays in the queue until the end of the day.
    expect(r.queueLengthByHour[20].max).toBe(1);
  });
});

describe("agent report", () => {
  it("counts served, no-show, transfers and derives utilisation from the status log", () => {
    const facts = [
      served("09:00", 1, 30, { agentId: "a1" }),
      served("10:00", 1, 30, { agentId: "a1", transfersOut: ["a2"] }),
      served("09:00", 1, 10, { agentId: "a2" }),
      fact({
        arrive: "12:00",
        agentId: "a2",
        firstCalledAt: at("2026-09-29", "12:05"),
        status: "NO_SHOW",
        finishedAt: at("2026-09-29", "12:10"),
      }),
    ];
    const log = [
      { userId: "a1", status: "AVAILABLE" as const, at: at("2026-09-29", "08:00") },
      { userId: "a1", status: "ON_BREAK" as const, at: at("2026-09-29", "11:00") },
      { userId: "a1", status: "AVAILABLE" as const, at: at("2026-09-29", "11:30") },
      { userId: "a1", status: "OFFLINE" as const, at: at("2026-09-29", "12:00") },
      { userId: "a2", status: "AVAILABLE" as const, at: at("2026-09-29", "09:00") },
    ];
    const r = computeReport(base(facts, { statusLog: log, now: at("2026-09-29", "14:00") }));
    const a1 = r.agents.find((a) => a.agentId === "a1")!;
    expect(a1).toMatchObject({
      served: 2,
      transferOut: 0,
      loginMin: 240,
      breakMin: 30,
      availableMin: 210,
      servingMin: 60,
      idleMin: 150,
    });
    expect(a1.utilisationPct).toBe(28.6); // 60 / (240 - 30)
    const a2 = r.agents.find((a) => a.agentId === "a2")!;
    expect(a2).toMatchObject({ served: 1, noShow: 1, transferOut: 1, loginMin: 300 });
    expect(r.summary.fairnessIndex).toBeCloseTo(0.9, 1); // 2 vs 1
  });

  it("starts the range in the state the agent was already in", () => {
    const t = agentTimes(
      [
        { status: "AVAILABLE", at: at("2026-09-28", "08:00") },
        { status: "OFFLINE", at: at("2026-09-29", "01:00") },
      ],
      at("2026-09-29", "00:00"),
      at("2026-09-30", "00:00"),
      at("2026-09-30", "00:00"),
    );
    expect(t.loginMin).toBe(60);
    expect(t.availableMin).toBe(60);
  });

  it("does not count time after 'now'", () => {
    const t = agentTimes(
      [{ status: "AVAILABLE", at: at("2026-09-29", "08:00") }],
      at("2026-09-29", "00:00"),
      at("2026-09-30", "00:00"),
      at("2026-09-29", "10:00"),
    );
    expect(t.loginMin).toBe(120);
  });
});

describe("forecast", () => {
  it("averages the same weekday and sizes staffing from service time", () => {
    // Two Tuesdays with 10 and 20 visitors at 10:00, and a Wednesday with 6.
    const arrivals = [
      ...Array.from({ length: 10 }, () => ({ at: at("2026-09-15", "10:10"), branchId: "b1" })),
      ...Array.from({ length: 20 }, () => ({ at: at("2026-09-22", "10:20"), branchId: "b1" })),
      ...Array.from({ length: 6 }, () => ({ at: at("2026-09-23", "09:10"), branchId: "b1" })),
    ];
    const f = computeForecast({
      arrivals,
      timezone: TZ,
      historyDays: ["2026-09-15", "2026-09-22", "2026-09-23"],
      today: "2026-09-28", // Monday: tomorrow is a Tuesday
      avgServiceMin: 10,
      targetUtilisationPct: 80,
    });
    expect(f.days[0]).toMatchObject({ date: "2026-09-29", weekday: 2, expected: 15 });
    expect(f.days[1]).toMatchObject({ date: "2026-09-30", weekday: 3, expected: 6 });
    const ten = f.tomorrow.hours[10];
    expect(ten.expected).toBe(15);
    expect(ten.agentsNeeded).toBe(Math.ceil((15 * 10) / (60 * 0.8))); // 4
    expect(f.tomorrow.hours[3]).toMatchObject({ expected: 0, agentsNeeded: 0 });
  });
});
