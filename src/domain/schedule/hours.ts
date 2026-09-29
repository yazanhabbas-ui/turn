import { toMinutes, zonedParts } from "./time";

export type ScheduleRuleInput = {
  kind: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
  validFrom?: string | null;
  validTo?: string | null;
};

export type RamadanPeriod = { enabled: boolean; from: string | null; to: string | null };

export function isRamadan(date: string, ramadan: RamadanPeriod | undefined): boolean {
  return !!ramadan?.enabled && !!ramadan.from && !!ramadan.to && date >= ramadan.from && date <= ramadan.to;
}

/**
 * Open intervals (minutes since local midnight) for a local date. Precedence: `special` rules valid on that
 * date, then `ramadan` rules during Ramadan mode, then `regular` rules.
 */
export function intervalsFor(
  date: string,
  weekday: number,
  rules: ScheduleRuleInput[],
  opts: { ramadan?: RamadanPeriod } = {},
): [number, number][] {
  const valid = (r: ScheduleRuleInput) => (!r.validFrom || date >= r.validFrom) && (!r.validTo || date <= r.validTo);
  const ofKind = (kind: string) => rules.filter((r) => r.kind === kind && valid(r));
  const special = ofKind("special");
  const ramadan = isRamadan(date, opts.ramadan) ? ofKind("ramadan") : [];
  // Once a special or Ramadan timetable exists at all, it replaces regular hours for every weekday.
  const chosen = special.length ? special : ramadan.length ? ramadan : ofKind("regular");
  return chosen
    .filter((r) => r.weekday === weekday)
    .map((r) => [toMinutes(r.opensAt), toMinutes(r.closesAt)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

export type OpenState = { open: true; closesInMinutes: number } | { open: false; reason: "closed" | "cutoff"; opensAt?: number };

/**
 * Whether new tickets may be issued now. No schedule = always open. `cutoffMinutes` stops issuing that many
 * minutes before the current interval closes.
 */
export function issuingState(
  at: number,
  tz: string,
  rules: ScheduleRuleInput[] | null,
  opts: { cutoffMinutes?: number; ramadan?: RamadanPeriod } = {},
): OpenState {
  if (!rules) return { open: true, closesInMinutes: Infinity };
  const p = zonedParts(at, tz);
  const intervals = intervalsFor(p.date, p.weekday, rules, opts);
  const current = intervals.find(([o, c]) => p.minutes >= o && p.minutes < c);
  if (!current) {
    const next = intervals.find(([o]) => o > p.minutes);
    return { open: false, reason: "closed", opensAt: next?.[0] };
  }
  const closesIn = current[1] - p.minutes;
  if (opts.cutoffMinutes && closesIn <= opts.cutoffMinutes) return { open: false, reason: "cutoff" };
  return { open: true, closesInMinutes: closesIn };
}
