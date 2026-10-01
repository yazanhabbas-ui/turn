import { describe, expect, it } from "vitest";
import {
  computeAgentReport,
  customRange,
  MAX_REPORT_DAYS,
  presetRange,
  previousRange,
  rangeBounds,
  statsOf,
  type ReportFact,
} from "@/domain/profile/agent-report";
import { zonedToUtc } from "@/domain/schedule/time";

const TZ = "Asia/Damascus";
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm, TZ);
const MIN = 60_000;
let seq = 0;

/** A visit that arrived at `hhmm`, waited `wait` minutes and was served for `service` minutes. */
function fact(date: string, hhmm: string, wait: number, service: number, extra: Partial<ReportFact> = {}): ReportFact {
  const arrivedAt = at(date, hhmm);
  const startedAt = arrivedAt + wait * MIN;
  return {
    id: `t${++seq}`,
    displayNumber: `A-${seq}`,
    reasonId: "general",
    reason: { en: "General", ar: "عام" },
    status: "COMPLETED",
    outcome: null,
    arrivedAt,
    firstCalledAt: startedAt,
    startedAt,
    finishedAt: startedAt + service * MIN,
    score: null,
    comment: null,
    ...extra,
  };
}

const base = (facts: ReportFact[], extra: Partial<Parameters<typeof computeAgentReport>[0]> = {}) =>
  computeAgentReport({
    range: { from: "2026-09-27", to: "2026-09-29", days: 3 },
    timezone: TZ,
    facts,
    previousFacts: [],
    branchFacts: null,
    feedbackOn: true,
    ...extra,
  });

describe("ranges", () => {
  it("presets end today in the branch zone and the week starts on Sunday", () => {
    const now = at("2026-09-29", "10:00"); // a Tuesday
    expect(presetRange("day", now, TZ)).toEqual({ from: "2026-09-29", to: "2026-09-29", days: 1 });
    expect(presetRange("week", now, TZ)).toEqual({ from: "2026-09-27", to: "2026-09-29", days: 3 });
    expect(presetRange("month", now, TZ)).toEqual({ from: "2026-09-01", to: "2026-09-29", days: 29 });
    // 00:30 in Damascus is still the previous day in UTC: the day is the local one.
    expect(presetRange("day", at("2026-09-30", "00:30"), TZ).from).toBe("2026-09-30");
  });

  it("accepts a custom range of up to 92 days and refuses anything else", () => {
    expect(customRange("2026-07-01", "2026-09-30")).toMatchObject({ days: MAX_REPORT_DAYS });
    expect(customRange("2026-06-30", "2026-09-30")).toBeNull();
    expect(customRange("2026-09-30", "2026-09-29")).toBeNull();
    expect(customRange("2026-02-30", "2026-03-02")).toBeNull();
    expect(customRange("nope", "2026-03-02")).toBeNull();
    expect(customRange("2026-09-29", "2026-09-29")?.days).toBe(1);
  });

  it("the previous period has the same length and ends the day before", () => {
    expect(previousRange({ from: "2026-09-27", to: "2026-09-29", days: 3 })).toEqual({
      from: "2026-09-24",
      to: "2026-09-26",
      days: 3,
    });
    const { start, end } = rangeBounds({ from: "2026-09-29", to: "2026-09-29" }, TZ);
    expect(end - start).toBe(24 * 60 * MIN);
    expect(start).toBe(at("2026-09-29", "00:00"));
  });
});

describe("computeAgentReport", () => {
  it("is empty and null-safe for a period with no visits", () => {
    const r = base([]);
    expect(r.totals).toMatchObject({
      served: 0,
      noShows: 0,
      avgServiceMin: null,
      avgWaitMin: null,
      resolvedPct: null,
      avgScore: null,
    });
    expect(r.daily).toEqual([]);
    expect(r.byReason).toEqual([]);
    expect(r.byHour.every((n) => n === 0)).toBe(true);
    expect(r.distribution.every((b) => b.count === 0)).toBe(true);
    expect(r.comparison.change.served).toEqual({ current: 0, previous: 0, changePct: null });
    expect(r.csat).toMatchObject({ avg: null, responses: 0, comments: [] });
  });

  it("buckets days in the branch time zone, not UTC", () => {
    // 00:20 Damascus on the 29th is 21:20 UTC on the 28th.
    const late = fact("2026-09-29", "00:10", 5, 5);
    const early = fact("2026-09-28", "23:30", 5, 5);
    expect(new Date(late.finishedAt).toISOString().slice(0, 10)).toBe("2026-09-28");
    const r = base([late, early]);
    expect(r.daily.map((d) => [d.date, d.served])).toEqual([
      ["2026-09-28", 1],
      ["2026-09-29", 1],
    ]);
  });

  it("averages service and the wait of served visitors, counts no-shows and the completed share", () => {
    const noShow: ReportFact = fact("2026-09-29", "10:00", 6, 0, { status: "NO_SHOW", startedAt: null });
    const r = base([fact("2026-09-29", "09:00", 4, 6), fact("2026-09-29", "09:30", 2, 10), noShow]);
    expect(r.totals).toMatchObject({ served: 2, noShows: 1, avgServiceMin: 8, avgWaitMin: 3, resolvedPct: 66.7 });
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ date: "2026-09-29", served: 2, noShows: 1 });
  });

  it("groups by reason, by starting hour and into service-time buckets", () => {
    const r = base([
      fact("2026-09-29", "09:00", 0, 1), // <2 min
      fact("2026-09-29", "09:45", 0, 12, { reasonId: "contract", reason: { en: "Contract" } }), // 10-15
      fact("2026-09-29", "11:10", 0, 40), // 30+
    ]);
    expect(r.byReason.map((x) => [x.reasonId, x.count])).toEqual([
      ["general", 2],
      ["contract", 1],
    ]);
    expect(r.byReason[0].avgServiceMin).toBe(20.5);
    expect(r.byHour[9]).toBe(2);
    expect(r.byHour[11]).toBe(1);
    expect(r.distribution.map((b) => b.count)).toEqual([1, 0, 0, 1, 0, 1]);
  });

  it("compares with the previous period and the branch average", () => {
    const r = base([fact("2026-09-29", "09:00", 2, 10), fact("2026-09-29", "10:00", 2, 10)], {
      previousFacts: [fact("2026-09-25", "09:00", 2, 20)],
      branchFacts: [fact("2026-09-29", "09:00", 2, 5), fact("2026-09-29", "09:20", 2, 7), fact("2026-09-29", "09:40", 2, 9)],
    });
    expect(r.comparison.previous).toMatchObject({ served: 1, avgServiceMin: 20 });
    expect(r.comparison.change.served).toEqual({ current: 2, previous: 1, changePct: 100 });
    expect(r.comparison.change.avgServiceMin).toEqual({ current: 10, previous: 20, changePct: -50 });
    expect(r.comparison.branch).toMatchObject({ served: 3, avgServiceMin: 7 });
    expect(r.previous).toEqual({ from: "2026-09-24", to: "2026-09-26", days: 3 });
  });

  it("summarises satisfaction with the average, distribution and latest comments", () => {
    const r = base([
      fact("2026-09-28", "09:00", 1, 5, { score: 5, comment: "quick" }),
      fact("2026-09-29", "09:00", 1, 5, { score: 3, comment: "ok" }),
      fact("2026-09-29", "10:00", 1, 5, { score: 4 }),
      fact("2026-09-29", "11:00", 1, 5),
    ]);
    expect(r.totals.avgScore).toBe(4);
    expect(r.totals.responses).toBe(3);
    expect(r.csat).toMatchObject({ avg: 4, responses: 3, satisfiedPct: 66.7 });
    expect(r.csat!.distribution.map((d) => d.count)).toEqual([0, 0, 1, 1, 1]);
    expect(r.csat!.comments.map((c) => c.comment)).toEqual(["ok", "quick"]); // newest first
    expect(r.daily.find((d) => d.date === "2026-09-29")).toMatchObject({ avgScore: 3.5, responses: 2 });
    expect(r.daily.find((d) => d.date === "2026-09-28")?.avgScore).toBe(5);
  });

  it("drops every satisfaction figure when feedback is switched off", () => {
    const r = base([fact("2026-09-29", "09:00", 1, 5, { score: 5, comment: "x" })], { feedbackOn: false });
    expect(r.csat).toBeNull();
    expect(r.totals.avgScore).toBeNull();
    expect(r.daily[0].avgScore).toBeNull();
  });

  it("statsOf keeps waits of no-shows out of the served wait", () => {
    const s = statsOf([
      fact("2026-09-29", "09:00", 10, 5),
      fact("2026-09-29", "09:30", 50, 0, { status: "NO_SHOW", startedAt: null }),
    ]);
    expect(s.avgWaitMin).toBe(10);
  });
});
