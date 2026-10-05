/**
 * "Negative rating" (D63): one threshold, the `feedback.lowScoreThreshold` setting, decides which answers count as
 * negative everywhere (low-score alerts, report comment lists, the wallboard panel, the agent's own views).
 * Pure: nothing is read from the database.
 */

export const NEGATIVE_MIN = 1;
export const NEGATIVE_MAX = 4;
export const NEGATIVE_DEFAULT = 2;

/** True when the score is at or below the threshold. */
export const isNegative = (score: number, threshold: number): boolean => score <= threshold;

/** Keeps a configured value inside the allowed stepper range. */
export const clampThreshold = (n: number): number => Math.min(NEGATIVE_MAX, Math.max(NEGATIVE_MIN, Math.round(n)));

/** The scores that count as negative for a threshold, e.g. 2 -> [1, 2]. */
export const negativeScores = (threshold: number): number[] => Array.from({ length: clampThreshold(threshold) }, (_, i) => i + 1);

/** Share of negative answers (0-100, one decimal); null when there are no answers. */
export function negativePct(scores: number[], threshold: number): number | null {
  if (!scores.length) return null;
  return Math.round((scores.filter((s) => isNegative(s, threshold)).length / scores.length) * 1000) / 10;
}

/** Caps a comment for a shared screen (adds an ellipsis when cut). */
export function truncateComment(comment: string, max = 80): string {
  const s = comment.trim();
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
