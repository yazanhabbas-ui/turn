import { describe, expect, it } from "vitest";
import { change, computeProgress, periodRanges, summarize, sumDays, type ProgressFact } from "@/domain/profile/progress";
import { zonedToUtc } from "@/domain/schedule/time";

const TZ = "Asia/Damascus";
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm, TZ);
const MIN = 60_000;

/** A served ticket: arrived, waited `wait` minutes, served for `service`. */
function fact(date: string, hhmm: string, wait: number, service: number, extra: Partial<ProgressFact> = {}): ProgressFact {
  const arrivedAt = at(date, hhmm);
  const firstCalledAt = arrivedAt + wait * MIN;
  const startedAt = firstCalledAt;
  return {
    agentId: "me",
    status: "COMPLETED",
    arrivedAt,
    firstCalledAt,
    startedAt,
    finishedAt: startedAt + service * MIN,
    ...extra,
  };
}

describe("summarize", () => {
  it("averages service and wait, counts no-shows and the completed share", () => {
    const s = summarize([
      fact("2026-09-29", "09:00", 4, 6),
      fact("2026-09-29", "09:30", 2, 10),
      {
        agentId: "me",
        status: "NO_SHOW",
        arrivedAt: at("2026-09-29", "10:00"),
        firstCalledAt: at("2026-09-29", "10:06"),
        startedAt: null,
        finishedAt: at("2026-09-29", "10:09"),
      },
    ]);
    expect(s).toMatchObject({ served: 2, noShows: 1, avgServiceMin: 8, avgWaitMin: 4, resolvedPct: 66.7, availableMin: null });
  });

  it("returns nulls for nothing, and availability from the status log", () => {
    const from = at("2026-09-29", "08:00");
    const s = summarize([], {
      log: [
        { status: "AVAILABLE", at: from },
        { status: "ON_BREAK", at: from + 60 * MIN },
        { status: "AVAILABLE", at: from + 75 * MIN },
      ],
      from,
      to: from + 120 * MIN,
      now: from + 120 * MIN,
    });
    expect(s).toMatchObject({
      served: 0,
      avgServiceMin: null,
      avgWaitMin: null,
      resolvedPct: null,
      availableMin: 105,
      breakMin: 15,
    });
  });
});

describe("change", () => {
  it("is a rounded percentage, and null without an earlier value", () => {
    expect(change(9, 8)).toEqual({ current: 9, previous: 8, changePct: 13 });
    expect(change(4, 8).changePct).toBe(-50);
    expect(change(3, 0).changePct).toBeNull();
    expect(change(null, null)).toEqual({ current: 0, previous: 0, changePct: null });
  });
});

describe("periodRanges", () => {
  // Wednesday 30 Sep 2026, 12:00 in Damascus
  const now = at("2026-09-30", "12:00");
  const r = periodRanges(now, TZ);

  it("starts the day at local midnight, the week on Sunday and the month on the 1st", () => {
    expect(r.day.from).toBe(at("2026-09-30", "00:00"));
    expect(r.week.from).toBe(at("2026-09-27", "00:00"));
    expect(r.month.from).toBe(at("2026-09-01", "00:00"));
  });

  it("compares like for like: the previous period only up to the same elapsed time", () => {
    expect(r.day.prevFrom).toBe(at("2026-09-29", "00:00"));
    expect(r.day.prevTo).toBe(at("2026-09-29", "12:00"));
    expect(r.week.prevFrom).toBe(at("2026-09-20", "00:00"));
    expect(r.week.prevTo).toBe(r.week.prevFrom + (now - r.week.from));
    expect(r.month.prevFrom).toBe(at("2026-08-01", "00:00"));
  });

  it("handles January", () => {
    expect(periodRanges(at("2027-01-10", "09:00"), TZ).month.prevFrom).toBe(at("2026-12-01", "00:00"));
  });
});

describe("computeProgress", () => {
  const now = at("2026-09-30", "12:00"); // Wednesday
  const mine = [
    fact("2026-09-30", "09:00", 3, 5), // today
    fact("2026-09-30", "10:00", 5, 7), // today
    fact("2026-09-29", "09:00", 4, 6), // yesterday (in the week)
    fact("2026-09-28", "09:00", 4, 6),
    fact("2026-09-22", "09:00", 4, 6), // last week, inside the compared span
    fact("2026-09-23", "16:00", 4, 6), // last week, after the compared span of the week
    fact("2026-08-15", "09:00", 4, 6), // last month
  ];
  const daily = (facts: ProgressFact[]) => {
    const m = new Map<string, number>();
    for (const f of facts) {
      const d = new Date(f.finishedAt + 3 * 3600_000).toISOString().slice(0, 10); // Damascus is UTC+3 in 2026
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return [...m].map(([date, count]) => ({ date, count }));
  };
  const colleague = fact("2026-09-30", "09:30", 10, 20, { agentId: "other" });
  const input = {
    now,
    timezone: TZ,
    period: "week" as const,
    agent: {
      facts: mine,
      branchFacts: [...mine, colleague],
      statusLog: [],
      servedDaily: daily(mine),
      branchActiveDays: ["2026-09-30", "2026-09-29", "2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25"],
    },
    actionsDaily: [{ date: "2026-09-30", count: 2 }],
  };

  it("computes tiles, previous period and branch average", () => {
    const p = computeProgress(input).agent!;
    expect(p.periods.day.current).toMatchObject({ served: 2, avgServiceMin: 6, avgWaitMin: 4 });
    expect(p.periods.day.previous.served).toBe(1);
    expect(p.periods.day.change.served).toEqual({ current: 2, previous: 1, changePct: 100 });
    expect(p.periods.week.current.served).toBe(4);
    // Like for like: only the first 3.5 days of last week (Sunday to Wednesday noon), so the Wednesday 16:00 ticket is out.
    expect(p.periods.week.previous.served).toBe(1);
    expect(p.periods.week.change.served.changePct).toBe(300);
    expect(p.periods.month.current.served).toBe(6);
    // Branch average: 5 tickets this week by 2 servers (me, other) this week.
    expect(p.periods.week.branch).toMatchObject({ servedPerAgent: 2.5 });
    expect(p.periods.day.branch?.servedPerAgent).toBe(1.5);
  });

  it("builds the trend, best day, totals and streak", () => {
    const p = computeProgress(input).agent!;
    expect(p.trend).toHaveLength(14);
    expect(p.trend.at(-1)).toEqual({ date: "2026-09-30", served: 2 });
    expect(p.trend.find((d) => d.date === "2026-09-29")?.served).toBe(1);
    expect(computeProgress({ ...input, period: "month" }).agent!.trend).toHaveLength(30);
    expect(p.milestones.totalServed).toBe(7);
    expect(p.milestones.bestDay).toEqual({ date: "2026-09-30", served: 2 });
    // 30, 29, 28 served; 27 and 26 the branch worked but I did not serve.
    expect(p.milestones.streakDays).toBe(3);
  });

  it("does not break a streak on days the branch did not work, nor on a quiet start of today", () => {
    const base = {
      ...input.agent,
      servedDaily: [
        { date: "2026-09-28", count: 1 },
        { date: "2026-09-25", count: 2 },
      ],
      branchActiveDays: ["2026-09-28", "2026-09-25", "2026-09-24"],
    };
    // Today has nothing yet, 29-26 are not working days (skipped), 28 served, 27 skipped... 25 served, 24 worked but not me -> break.
    expect(computeProgress({ ...input, agent: base }).agent!.milestones.streakDays).toBe(2);
  });

  it("leaves the agent block out for people who do not serve", () => {
    const p = computeProgress({
      ...input,
      agent: undefined,
      issuedDaily: [
        { date: "2026-09-30", count: 5 },
        { date: "2026-09-29", count: 4 },
      ],
    });
    expect(p.agent).toBeNull();
    expect(p.issued?.periods.day).toEqual({ current: 5, previous: 4, changePct: 25 });
    expect(p.actions.periods.day.current).toBe(2);
    expect(p.issued?.trend.at(-1)).toEqual({ date: "2026-09-30", count: 5 });
  });
});

describe("sumDays", () => {
  it("sums inclusively", () => {
    const d = [
      { date: "2026-09-01", count: 1 },
      { date: "2026-09-02", count: 2 },
      { date: "2026-09-03", count: 4 },
    ];
    expect(sumDays(d, "2026-09-02", "2026-09-03")).toBe(6);
  });
});
