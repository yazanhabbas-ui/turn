/**
 * Next ticket number for a queue given the day's counter for its prefix. Several reasons may share a prefix;
 * they then share one sequence (still unique per branch, day and prefix).
 */
export function nextNumber(lastNumber: number, range: { start: number; end: number }): number | null {
  const next = Math.max(lastNumber + 1, range.start);
  return next > range.end ? null : next;
}
