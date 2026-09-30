/**
 * Visitor feedback (CSAT) arithmetic. Pure: everything is passed in, nothing is read from the database.
 * A score is 1-5; 4 and 5 count as "satisfied". NPS answers are 0-10 (9-10 promoters, 0-6 detractors).
 */

export const SCORES = [1, 2, 3, 4, 5] as const;
export const SATISFIED_FROM = 4;
export const COMMENT_MAX = 500;

/** One visitor answer. */
export type FeedbackFact = {
  id: string;
  ticketId: string;
  score: number;
  nps: number | null;
  comment: string | null;
  /** When the answer came in (ms). */
  at: number;
  displayNumber?: string;
};

export type NpsSummary = {
  responses: number;
  /** Promoters minus detractors, -100..100. */
  score: number;
  promotersPct: number;
  passivesPct: number;
  detractorsPct: number;
};

export type CsatSummary = {
  responses: number;
  /** Average score 1-5, two decimals; null when nobody answered. */
  avg: number | null;
  /** Share of answers that were 4 or 5 (0-100). */
  satisfiedPct: number;
  /** Answers as a share of the visits that could be rated (0-100). */
  responseRatePct: number;
  /** Visits that could be rated (completed). */
  eligible: number;
  distribution: { score: number; count: number }[];
  /** Null when nobody answered the recommend question. */
  nps: NpsSummary | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function averageScore(scores: number[]): number | null {
  return scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export function satisfiedPct(scores: number[]): number {
  return scores.length ? round1((scores.filter((s) => s >= SATISFIED_FROM).length / scores.length) * 100) : 0;
}

export function npsOf(values: number[]): NpsSummary | null {
  if (!values.length) return null;
  const n = values.length;
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  return {
    responses: n,
    score: Math.round(((promoters - detractors) / n) * 100),
    promotersPct: round1((promoters / n) * 100),
    passivesPct: round1(((n - promoters - detractors) / n) * 100),
    detractorsPct: round1((detractors / n) * 100),
  };
}

/** Summary of a set of answers; `eligible` is how many visits could have been rated (for the response rate). */
export function summarizeCsat(facts: Pick<FeedbackFact, "score" | "nps">[], eligible: number): CsatSummary {
  const scores = facts.map((f) => f.score);
  return {
    responses: facts.length,
    avg: averageScore(scores),
    satisfiedPct: satisfiedPct(scores),
    responseRatePct: eligible > 0 ? Math.min(100, round1((facts.length / eligible) * 100)) : 0,
    eligible,
    distribution: SCORES.map((score) => ({ score, count: scores.filter((s) => s === score).length })),
    nps: npsOf(facts.map((f) => f.nps).filter((v): v is number => v !== null)),
  };
}

/** Trims the comment; empty becomes null. Throws nothing: length is validated by the caller. */
export function cleanComment(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
}
