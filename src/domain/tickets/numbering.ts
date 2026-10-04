import { toWesternDigits } from "../i18n/digits";

/**
 * Next ticket number for a queue given the day's counter for its prefix. Several reasons may share a prefix;
 * they then share one sequence (still unique per branch, day and prefix).
 */
export function nextNumber(lastNumber: number, range: { start: number; end: number }): number | null {
  const next = Math.max(lastNumber + 1, range.start);
  return next > range.end ? null : next;
}

/**
 * The number after `last` when the numbers may restart during the day. After `range.end` the next ticket is
 * `range.start` again and the `cycle` goes up by one (A-100, then A-001), so the pair (cycle, number) stays unique
 * within the service day. A number that `inUse` (a visitor with that number is still in the queue) is skipped, so two
 * waiting visitors never share a ticket number. Returns null when no number is free, or when the range is used up and
 * `wrap` is off.
 */
export function nextCyclicNumber(
  last: number,
  cycle: number,
  range: { start: number; end: number },
  opts: { wrap: boolean; inUse?: (n: number) => boolean },
): { number: number; cycle: number } | null {
  let candidate = Math.max(last + 1, range.start);
  let current = cycle;
  const size = Math.max(0, range.end - range.start + 1);
  for (let tried = 0; tried <= size; tried++) {
    if (candidate > range.end) {
      if (!opts.wrap) return null;
      candidate = range.start;
      current += 1;
    }
    if (!opts.inUse?.(candidate)) return { number: candidate, cycle: current };
    candidate += 1;
  }
  return null;
}

/**
 * The last `digits` digits of a phone number (Eastern Arabic digits and separators are fine), or null when it has
 * fewer. They are what the screens and the voice call when no ticket is printed.
 */
export function callCodeOf(raw: string, digits: number): string | null {
  const only = toWesternDigits(raw).replace(/\D/g, "");
  return only.length >= digits ? only.slice(-digits) : null;
}
