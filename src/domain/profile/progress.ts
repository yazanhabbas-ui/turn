import { averageScore, satisfiedPct } from "../feedback/csat";
import { isNegative, NEGATIVE_DEFAULT, negativePct } from "../feedback/negative";
import { agentTimes, mean } from "../reports/compute";
import { zonedParts, zonedToUtc } from "../schedule/time";

/** Periods shown on the profile: today, this week (from Sunday, like the reports) and this month. */
export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

const MIN = 60_000;
const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A ticket an agent finished (completed or no-show), with the instants needed for the numbers. */
export type ProgressFact = {
  agentId: string | null;
  status: "COMPLETED" | "NO_SHOW";
  arrivedAt: number;
  firstCalledAt: number | null;
  startedAt: number | null;
  finishedAt: number;
};

export type DayCount = { date: string; count: number };

/** A visitor's answer about a visit the agent served. */
export type ProgressFeedback = {
  agentId: string | null;
  score: number;
  comment: string | null;
  at: number;
  /** Ticket number the answer belongs to (shown with the comment so the agent can find the visit). */
  displayNumber?: string;
};

export type CsatStats = {
  avg: number | null;
  responses: number;
  satisfiedPct: number | null;
  /** Answers at or below the negative threshold (D63), as a count and a share. */
  negative: number;
  negativePct: number | null;
};

export type CsatPeriod = {
  current: CsatStats;
  previous: CsatStats;
  /** Average of every agent's answers in the branch (aggregate only, no colleague is named). */
  branchAvg: number | null;
};

export type Stats = {
  served: number;
  noShows: number;
  /** Minutes; null when there is nothing to average. */
  avgServiceMin: number | null;
  avgWaitMin: number | null;
  /** Completed as a share of completed + no-show (0-100); null when there were none. */
  resolvedPct: number | null;
  /** Time signed in as available/busy, and on breaks (minutes); null when the status log is not provided. */
  availableMin: number | null;
  breakMin: number | null;
};

export type BranchStats = {
  /** Served per agent who served at least one visitor in the period. */
  servedPerAgent: number | null;
  avgServiceMin: number | null;
  avgWaitMin: number | null;
  resolvedPct: number | null;
};

export type Change = { current: number; previous: number; changePct: number | null };

export type AgentPeriod = {
  current: Stats;
  previous: Stats;
  /** Change of `served`, average service time and average wait against the previous period. */
  change: { served: Change; avgServiceMin: Change; avgWaitMin: Change };
  branch: BranchStats | null;
};

export type ProgressInput = {
  now: number;
  timezone: string;
  period: Period;
  agent?: {
    /** The agent's own finished tickets from the start of the previous month on. */
    facts: ProgressFact[];
    /** Every agent's finished tickets of the branch over the same window (only aggregated, never listed). */
    branchFacts: ProgressFact[] | null;
    /** Status changes of the agent, including the last one before the window. */
    statusLog: { status: string; at: number }[];
    /** Completed tickets per local day, all time. */
    servedDaily: DayCount[];
    /** Local days on which anybody at the branch served a visitor (days off are not counted against a streak). */
    branchActiveDays: string[];
    /** Visitor feedback on the agent's visits, and on the whole branch (aggregated only); omitted when feedback is off. */
    feedback?: { own: ProgressFeedback[]; branch: ProgressFeedback[] | null };
    /** Scores up to this are negative (default 2). */
    negativeThreshold?: number;
    /** Hall sessions the agent hosted and finished (D62), with the visitors who came to each. */
    hosted?: { closedAt: number; visitors: number }[];
  };
  /** Tickets issued by the user per local day (reception). */
  issuedDaily?: DayCount[];
  /** Audited actions of the user per local day. */
  actionsDaily: DayCount[];
};

export type CountBlock = Record<Period, Change>;

export type Progress = {
  period: Period;
  timezone: string;
  agent: null | {
    periods: Record<Period, AgentPeriod>;
    trend: { date: string; served: number }[];
    /** Visitor satisfaction; null when feedback is off. */
    csat: null | {
      periods: Record<Period, CsatPeriod>;
      /** Scores up to this count as negative (the `feedback.lowScoreThreshold` setting). */
      threshold: number;
      trend: { date: string; avg: number | null; responses: number }[];
      /** The latest comments on the agent's own visits. */
      recent: { at: number; score: number; comment: string; displayNumber: string | null }[];
    };
    /** Hall sessions hosted and visitors received in them per period; absent when the agent hosted none in the window. */
    hosted?: Record<Period, { sessions: number; visitors: number }>;
    milestones: {
      totalServed: number;
      bestDay: { date: string; served: number } | null;
      /** Consecutive working days (days the branch served anyone) with at least one visitor served, up to today. */
      streakDays: number;
      activeDays: number;
    };
  };
  issued: null | { periods: CountBlock; trend: { date: string; count: number }[] };
  actions: { periods: CountBlock; trend: { date: string; count: number }[] };
};

export const trendDays = (period: Period) => (period === "month" ? 30 : 14);

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Start of the current period and of the previous one, plus how far into the previous one the comparison reaches. */
export function periodRanges(now: number, tz: string): Record<Period, { from: number; prevFrom: number; prevTo: number }> {
  const p = zonedParts(now, tz);
  const startOf = (date: string) => zonedToUtc(date, "00:00", tz);
  const monthStart = `${p.date.slice(0, 8)}01`;
  const prevMonth = p.month === 1 ? `${p.year - 1}-12-01` : `${p.year}-${String(p.month - 1).padStart(2, "0")}-01`;
  const weekStart = addDays(p.date, -p.weekday);
  const starts: Record<Period, [string, string]> = {
    day: [p.date, addDays(p.date, -1)],
    week: [weekStart, addDays(weekStart, -7)],
    month: [monthStart, prevMonth],
  };
  const out = {} as Record<Period, { from: number; prevFrom: number; prevTo: number }>;
  for (const k of PERIODS) {
    const from = startOf(starts[k][0]);
    const prevFrom = startOf(starts[k][1]);
    // Like for like: the previous period is only compared up to the same elapsed time ("so far this week vs so far last week").
    out[k] = { from, prevFrom, prevTo: Math.min(prevFrom + (now - from), from) };
  }
  return out;
}

export function summarize(
  facts: ProgressFact[],
  status?: { log: { status: string; at: number }[]; from: number; to: number; now: number },
): Stats {
  const done = facts.filter((f) => f.status === "COMPLETED");
  const service = done.filter((f) => f.startedAt !== null).map((f) => Math.max(0, f.finishedAt - f.startedAt!) / MIN);
  const wait = facts.filter((f) => f.firstCalledAt !== null).map((f) => Math.max(0, f.firstCalledAt! - f.arrivedAt) / MIN);
  const times = status ? agentTimes(status.log, status.from, status.to, status.now) : null;
  return {
    served: done.length,
    noShows: facts.length - done.length,
    avgServiceMin: service.length ? round1(mean(service)) : null,
    avgWaitMin: wait.length ? round1(mean(wait)) : null,
    resolvedPct: facts.length ? round1((done.length / facts.length) * 100) : null,
    availableMin: times ? Math.round(times.availableMin) : null,
    breakMin: times ? Math.round(times.breakMin) : null,
  };
}

export function change(current: number | null, previous: number | null): Change {
  const c = current ?? 0;
  const p = previous ?? 0;
  return { current: c, previous: p, changePct: p > 0 ? Math.round(((c - p) / p) * 100) : null };
}

/** Sum of a per-day count over local dates from..to inclusive. */
export function sumDays(daily: DayCount[], from: string, to: string): number {
  return daily.filter((d) => d.date >= from && d.date <= to).reduce((n, d) => n + d.count, 0);
}

function trendOf(daily: DayCount[], today: string, days: number) {
  const byDate = new Map(daily.map((d) => [d.date, d.count]));
  return Array.from({ length: days }, (_, i) => addDays(today, i - days + 1)).map((date) => ({
    date,
    count: byDate.get(date) ?? 0,
  }));
}

function countBlock(daily: DayCount[], now: number, tz: string): CountBlock {
  const ranges = periodRanges(now, tz);
  const today = zonedParts(now, tz).date;
  return Object.fromEntries(
    PERIODS.map((k) => {
      const r = ranges[k];
      const cur = sumDays(daily, zonedParts(r.from, tz).date, today);
      const prev = r.prevTo > r.prevFrom ? sumDays(daily, zonedParts(r.prevFrom, tz).date, zonedParts(r.prevTo - 1, tz).date) : 0;
      return [k, change(cur, prev)];
    }),
  ) as CountBlock;
}

/** Consecutive working days, counting back from today, on which the agent served somebody. */
function streakOf(mine: Set<string>, branchActive: string[], today: string): number {
  const working = new Set([...branchActive, ...mine]);
  let streak = 0;
  for (let i = 0, d = today; i < 400; i++, d = addDays(d, -1)) {
    // A day the branch did not work at all (a weekend, a day off) neither counts nor breaks the streak.
    if (!working.has(d)) continue;
    if (mine.has(d)) streak++;
    // Today does not break the streak just because the day has barely begun.
    else if (d !== today) break;
  }
  return streak;
}

/** A person's own numbers. Pure: every input is passed in, nothing is read from the database or the clock. */
export function computeProgress(input: ProgressInput): Progress {
  const { now, timezone: tz, period } = input;
  const ranges = periodRanges(now, tz);
  const today = zonedParts(now, tz).date;
  const days = trendDays(period);

  let agent: Progress["agent"] = null;
  if (input.agent) {
    const a = input.agent;
    const periods = {} as Record<Period, AgentPeriod>;
    const within = (facts: ProgressFact[], from: number, to: number) =>
      facts.filter((f) => f.finishedAt >= from && f.finishedAt < to);
    for (const k of PERIODS) {
      const r = ranges[k];
      const cur = summarize(within(a.facts, r.from, now + 1), { log: a.statusLog, from: r.from, to: now + 1, now });
      const prev = summarize(within(a.facts, r.prevFrom, r.prevTo), { log: a.statusLog, from: r.prevFrom, to: r.prevTo, now });
      let branch: BranchStats | null = null;
      if (a.branchFacts) {
        const facts = within(a.branchFacts, r.from, now + 1);
        const servers = new Set(facts.filter((f) => f.status === "COMPLETED").map((f) => f.agentId));
        const s = summarize(facts);
        branch = {
          servedPerAgent: servers.size ? round1(s.served / servers.size) : null,
          avgServiceMin: s.avgServiceMin,
          avgWaitMin: s.avgWaitMin,
          resolvedPct: s.resolvedPct,
        };
      }
      periods[k] = {
        current: cur,
        previous: prev,
        change: {
          served: change(cur.served, prev.served),
          avgServiceMin: change(cur.avgServiceMin, prev.avgServiceMin),
          avgWaitMin: change(cur.avgWaitMin, prev.avgWaitMin),
        },
        branch,
      };
    }

    let csat: NonNullable<Progress["agent"]>["csat"] = null;
    if (a.feedback) {
      const fb = a.feedback;
      const threshold = a.negativeThreshold ?? NEGATIVE_DEFAULT;
      const stats = (list: ProgressFeedback[]): CsatStats => {
        const scores = list.map((x) => x.score);
        return {
          avg: averageScore(scores),
          responses: scores.length,
          satisfiedPct: scores.length ? satisfiedPct(scores) : null,
          negative: scores.filter((x) => isNegative(x, threshold)).length,
          negativePct: negativePct(scores, threshold),
        };
      };
      const between = (list: ProgressFeedback[], from: number, to: number) => list.filter((x) => x.at >= from && x.at < to);
      const csatPeriods = {} as Record<Period, CsatPeriod>;
      for (const k of PERIODS) {
        const r = ranges[k];
        csatPeriods[k] = {
          current: stats(between(fb.own, r.from, now + 1)),
          previous: stats(between(fb.own, r.prevFrom, r.prevTo)),
          branchAvg: fb.branch ? averageScore(between(fb.branch, r.from, now + 1).map((x) => x.score)) : null,
        };
      }
      const byDate = new Map<string, number[]>();
      for (const x of fb.own) {
        const date = zonedParts(x.at, tz).date;
        byDate.set(date, [...(byDate.get(date) ?? []), x.score]);
      }
      csat = {
        periods: csatPeriods,
        threshold,
        trend: Array.from({ length: days }, (_, i) => addDays(today, i - days + 1)).map((date) => ({
          date,
          avg: averageScore(byDate.get(date) ?? []),
          responses: (byDate.get(date) ?? []).length,
        })),
        recent: fb.own
          .filter((x) => x.comment)
          .sort((x, y) => y.at - x.at)
          .slice(0, 5)
          .map((x) => ({ at: x.at, score: x.score, comment: x.comment!, displayNumber: x.displayNumber ?? null })),
      };
    }

    let hosted: NonNullable<Progress["agent"]>["hosted"];
    if (a.hosted?.length) {
      const sums = {} as Record<Period, { sessions: number; visitors: number }>;
      for (const k of PERIODS) {
        const list = a.hosted.filter((x) => x.closedAt >= ranges[k].from && x.closedAt < now + 1);
        sums[k] = { sessions: list.length, visitors: list.reduce((n, x) => n + x.visitors, 0) };
      }
      if (PERIODS.some((k) => sums[k].sessions > 0)) hosted = sums;
    }

    const served = a.servedDaily.filter((d) => d.count > 0);
    const best = served.reduce<DayCount | null>((m, d) => (!m || d.count > m.count ? d : m), null);
    agent = {
      periods,
      trend: trendOf(a.servedDaily, today, days).map((t) => ({ date: t.date, served: t.count })),
      csat,
      ...(hosted ? { hosted } : {}),
      milestones: {
        totalServed: served.reduce((n, d) => n + d.count, 0),
        bestDay: best ? { date: best.date, served: best.count } : null,
        streakDays: streakOf(new Set(served.map((d) => d.date)), a.branchActiveDays, today),
        activeDays: served.length,
      },
    };
  }

  return {
    period,
    timezone: tz,
    agent,
    issued: input.issuedDaily
      ? { periods: countBlock(input.issuedDaily, now, tz), trend: trendOf(input.issuedDaily, today, days) }
      : null,
    actions: { periods: countBlock(input.actionsDaily, now, tz), trend: trendOf(input.actionsDaily, today, days) },
  };
}
