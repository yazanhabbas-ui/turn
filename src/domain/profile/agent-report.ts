import { averageScore, SCORES, satisfiedPct } from "../feedback/csat";
import { mean } from "../reports/compute";
import { zonedParts, zonedToUtc } from "../schedule/time";
import { change, type Change } from "./progress";

/**
 * The agent's own work report for a period. Pure: the facts are passed in, nothing is read from the database.
 * Days are counted in the branch time zone by the day the visit was finished. Nothing depends on opening hours (D29, D30).
 */

export const REPORT_PRESETS = ["day", "week", "month"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
/** Longest custom range (days, both ends included). */
export const MAX_REPORT_DAYS = 92;
/** Lower edges (minutes) of the service-time buckets; the last bucket is open-ended. */
export const SERVICE_BUCKET_EDGES = [0, 2, 5, 10, 15, 30] as const;

const MIN = 60_000;
const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Whole days from `from` to `to`, both included. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export type ReportRange = { from: string; to: string; days: number };

/** Today, this week (from Sunday, like the reports) or this month, ending today in the time zone. */
export function presetRange(preset: ReportPreset, now: number, tz: string): ReportRange {
  const p = zonedParts(now, tz);
  const from = preset === "day" ? p.date : preset === "week" ? addDays(p.date, -p.weekday) : `${p.date.slice(0, 8)}01`;
  return { from, to: p.date, days: daysBetween(from, p.date) };
}

/** Validates a custom range: real dates, from before or equal to, and at most MAX_REPORT_DAYS. Returns null when invalid. */
export function customRange(from: string, to: string): ReportRange | null {
  if (!validDate(from) || !validDate(to) || from > to) return null;
  const days = daysBetween(from, to);
  return days > MAX_REPORT_DAYS ? null : { from, to, days };
}

/** The period of the same length that ends the day before `range` starts. */
export function previousRange(range: ReportRange): ReportRange {
  return { from: addDays(range.from, -range.days), to: addDays(range.from, -1), days: range.days };
}

/** UTC instants (start inclusive, end exclusive) of a range of local dates. */
export function rangeBounds(range: { from: string; to: string }, tz: string): { start: number; end: number } {
  return { start: zonedToUtc(range.from, "00:00", tz), end: zonedToUtc(addDays(range.to, 1), "00:00", tz) };
}

/** A visit the agent finished (served or no-show), with what is needed to report on it. */
export type ReportFact = {
  id: string;
  displayNumber: string;
  reasonId: string;
  reason: Record<string, string>;
  status: "COMPLETED" | "NO_SHOW";
  outcome: string | null;
  arrivedAt: number;
  firstCalledAt: number | null;
  startedAt: number | null;
  finishedAt: number;
  /** The visitor's satisfaction score 1-5, when they answered. */
  score: number | null;
  comment: string | null;
};
export type AggregateFact = Pick<ReportFact, "status" | "arrivedAt" | "firstCalledAt" | "startedAt" | "finishedAt" | "score">;

export type ReportStats = {
  served: number;
  noShows: number;
  avgServiceMin: number | null;
  /** Average wait of the visitors served (arrival to the first call). */
  avgWaitMin: number | null;
  /** Completed as a share of completed + no-show (0-100). */
  resolvedPct: number | null;
  avgScore: number | null;
  responses: number;
};

export type DailyRow = ReportStats & { date: string };
export type ReasonRow = { reasonId: string; name: Record<string, string>; count: number; avgServiceMin: number | null };
export type Bucket = { fromMin: number; toMin: number | null; count: number };

export type AgentReport = {
  range: ReportRange & { timezone: string };
  previous: ReportRange;
  totals: ReportStats;
  daily: DailyRow[];
  byReason: ReasonRow[];
  /** Visits handled per hour of the day (0-23), by the hour service started. */
  byHour: number[];
  distribution: Bucket[];
  comparison: {
    previous: ReportStats;
    /** Every agent of the branch together (aggregate only, no colleague is named); null when unknown. */
    branch: ReportStats | null;
    change: { served: Change; avgServiceMin: Change; avgWaitMin: Change };
  };
  csat: {
    avg: number | null;
    responses: number;
    satisfiedPct: number | null;
    distribution: { score: number; count: number }[];
    /** Latest written comments of the period. */
    comments: { at: number; score: number; comment: string; displayNumber: string }[];
  } | null;
};

export function statsOf(facts: AggregateFact[]): ReportStats {
  const done = facts.filter((f) => f.status === "COMPLETED");
  const service = done.filter((f) => f.startedAt !== null).map((f) => Math.max(0, f.finishedAt - f.startedAt!) / MIN);
  const wait = done.filter((f) => f.firstCalledAt !== null).map((f) => Math.max(0, f.firstCalledAt! - f.arrivedAt) / MIN);
  const scores = facts.map((f) => f.score).filter((s): s is number => s !== null);
  return {
    served: done.length,
    noShows: facts.length - done.length,
    avgServiceMin: service.length ? round1(mean(service)) : null,
    avgWaitMin: wait.length ? round1(mean(wait)) : null,
    resolvedPct: facts.length ? round1((done.length / facts.length) * 100) : null,
    avgScore: averageScore(scores),
    responses: scores.length,
  };
}

export function computeAgentReport(input: {
  range: ReportRange;
  timezone: string;
  facts: ReportFact[];
  previousFacts: AggregateFact[];
  /** Null when the branch is unknown. */
  branchFacts: AggregateFact[] | null;
  /** False when visitor feedback is switched off: no satisfaction block, no scores. */
  feedbackOn: boolean;
}): AgentReport {
  const { range, timezone: tz } = input;
  const strip = <T extends AggregateFact>(list: T[]): T[] => (input.feedbackOn ? list : list.map((f) => ({ ...f, score: null })));
  const own = strip(input.facts);
  const day = (f: { finishedAt: number }) => zonedParts(f.finishedAt, tz).date;

  const byDay = new Map<string, ReportFact[]>();
  for (const f of own) byDay.set(day(f), [...(byDay.get(day(f)) ?? []), f]);
  const daily = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, list]) => ({ date, ...statsOf(list) }));

  const byReasonMap = new Map<string, ReportFact[]>();
  for (const f of own) byReasonMap.set(f.reasonId, [...(byReasonMap.get(f.reasonId) ?? []), f]);
  const byReason = [...byReasonMap.entries()]
    .map(([reasonId, list]) => ({
      reasonId,
      name: list[0].reason,
      count: list.length,
      avgServiceMin: statsOf(list).avgServiceMin,
    }))
    .sort((a, b) => b.count - a.count);

  const byHour = new Array<number>(24).fill(0);
  for (const f of own) byHour[Math.floor(zonedParts(f.startedAt ?? f.finishedAt, tz).minutes / 60)]++;

  const distribution: Bucket[] = SERVICE_BUCKET_EDGES.map((fromMin, i) => ({
    fromMin,
    toMin: SERVICE_BUCKET_EDGES[i + 1] ?? null,
    count: 0,
  }));
  for (const f of own) {
    if (f.status !== "COMPLETED" || f.startedAt === null) continue;
    const m = Math.max(0, f.finishedAt - f.startedAt) / MIN;
    [...distribution].reverse().find((x) => m >= x.fromMin)!.count++;
  }

  const totals = statsOf(own);
  const prev = statsOf(strip(input.previousFacts));
  const branch = input.branchFacts ? statsOf(strip(input.branchFacts)) : null;

  const scores = own.map((f) => f.score).filter((s): s is number => s !== null);
  const csat = input.feedbackOn
    ? {
        avg: averageScore(scores),
        responses: scores.length,
        satisfiedPct: scores.length ? satisfiedPct(scores) : null,
        distribution: SCORES.map((score) => ({ score, count: scores.filter((s) => s === score).length })),
        comments: own
          .filter((f) => f.score !== null && f.comment)
          .sort((a, b) => b.finishedAt - a.finishedAt)
          .slice(0, 5)
          .map((f) => ({ at: f.finishedAt, score: f.score!, comment: f.comment!, displayNumber: f.displayNumber })),
      }
    : null;

  return {
    range: { ...range, timezone: tz },
    previous: previousRange(range),
    totals,
    daily,
    byReason,
    byHour,
    distribution,
    comparison: {
      previous: prev,
      branch,
      change: {
        served: change(totals.served, prev.served),
        avgServiceMin: change(totals.avgServiceMin, prev.avgServiceMin),
        avgWaitMin: change(totals.avgWaitMin, prev.avgWaitMin),
      },
    },
    csat,
  };
}
