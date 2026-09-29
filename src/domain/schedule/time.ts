/** Wall-clock parts of an instant in an IANA time zone (no dependencies; uses Intl). */
export type ZonedParts = { date: string; weekday: number; minutes: number; year: number; month: number; day: number };

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(at: number | Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** "HH:MM" → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The branch business day an instant belongs to. With a reset time of 03:00, 01:30 on the 5th still belongs
 * to the 4th, so a late shift keeps its numbering.
 */
export function serviceDay(at: number, tz: string, resetTime = "00:00"): string {
  return zonedParts(at - toMinutes(resetTime) * 60_000, tz).date;
}

/** UTC epoch ms of a local wall-clock time on a local date in a time zone (DST-safe by two-pass correction). */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, 0) + toMinutes(hhmm) * 60_000;
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ts, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day) + p.minutes * 60_000;
    ts += guess - asUtc;
  }
  return ts;
}
