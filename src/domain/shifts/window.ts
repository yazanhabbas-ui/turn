import { toMinutes, zonedParts } from "../schedule/time";

export type ShiftTimes = { startsAt: string; endsAt: string };

/** Minutes since midnight at which the shift starts and ends (end > 1440 when it runs past midnight). */
function span(s: ShiftTimes): [number, number] {
  const start = toMinutes(s.startsAt);
  const end = toMinutes(s.endsAt);
  return [start, end > start ? end : end + 1440];
}

export type ShiftState = {
  onShift: boolean;
  /** Minutes until the shift ends (when on shift) or 0. */
  endsInMinutes: number;
  /** Minutes until the next start (when off shift) or 0. */
  startsInMinutes: number;
};

/**
 * Whether a shift is running at an instant, in the branch's time zone. Shifts may cross midnight: an evening shift
 * 22:00-06:00 is "on" at 01:00.
 */
export function shiftState(shift: ShiftTimes, at: number, tz: string): ShiftState {
  const minute = zonedParts(at, tz).minutes;
  const [start, end] = span(shift);
  // Try "today" and the previous day's occurrence (for the part after midnight).
  for (const m of [minute, minute + 1440]) {
    if (m >= start && m < end) return { onShift: true, endsInMinutes: end - m, startsInMinutes: 0 };
  }
  const untilStart = (start - minute + 1440) % 1440;
  return { onShift: false, endsInMinutes: 0, startsInMinutes: untilStart === 0 ? 1440 : untilStart };
}

/** Does a local time of day (minutes since midnight) fall inside the shift? */
export function minuteInShift(shift: ShiftTimes, minute: number): boolean {
  const [start, end] = span(shift);
  return (minute >= start && minute < end) || (minute + 1440 >= start && minute + 1440 < end);
}

/** Minutes since the shift last ended (0 while it is running). Used to sign agents out a little after the end. */
export function minutesSinceEnd(shift: ShiftTimes, at: number, tz: string): number {
  if (shiftState(shift, at, tz).onShift) return 0;
  const minute = zonedParts(at, tz).minutes;
  const end = toMinutes(shift.endsAt) % 1440;
  return (minute - end + 1440) % 1440;
}
