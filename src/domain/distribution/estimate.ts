/**
 * Estimated wait in minutes for a visitor with `ahead` people in front of them, given how many agents are
 * serving that queue and the average service time. Rounded up; never negative.
 */
export function estimateWaitMinutes(ahead: number, servingAgents: number, avgServiceMinutes: number): number {
  if (ahead <= 0) return 0;
  const agents = Math.max(1, servingAgents);
  return Math.ceil((ahead * Math.max(0.5, avgServiceMinutes)) / agents);
}

/** Exponentially weighted moving average of observed service times, seeded with the reason's expected time. */
export function updateAverage(previous: number, observed: number, alpha = 0.2): number {
  return previous + alpha * (observed - previous);
}

// ─── Configurable waiting-time estimate (setting group `waitEstimate`) ──────────────────────────────────────────

export type WaitMode = "fixed" | "reason" | "analytics";
export type WaitStatistic = "average" | "median" | "p75";

/** The parts of the `waitEstimate` setting that decide how long one visitor takes. */
export type ServiceModelConfig = {
  mode: WaitMode;
  fixedMinutesPerVisitor: number;
  minSamples: number;
  statistic: WaitStatistic;
  weightByHour: boolean;
  trimOutliers: boolean;
};

/** One completed service: its length in minutes and when it started (branch-local hour 0-23 and weekday 0-6). */
export type ServiceSample = { minutes: number; hour: number; dow: number };
/** Where in the week the estimate is made. */
export type SampleMoment = { hour: number; dow: number };

/** Services shorter or longer than this are treated as mistakes (a ticket closed at once, or left open overnight). */
export const MIN_VALID_SERVICE_MINUTES = 20 / 60;
export const MAX_VALID_SERVICE_MINUTES = 4 * 60;
/** Share of the samples dropped at each end when outliers are trimmed. */
export const TRIM_FRACTION = 0.05;
/** Range around the estimate when no measured spread exists (fixed and per-reason modes). */
export const DEFAULT_SPREAD = 0.25;

export type SampleSummary = { n: number; average: number; median: number; p25: number; p75: number; p90: number };

/** Linear-interpolated percentile (p in 0..1) of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Statistics of service durations in minutes. `n` counts the valid samples before the tails are trimmed. */
export function summarizeSamples(durations: number[], cfg: { trimOutliers?: boolean } = {}): SampleSummary {
  let d = durations.filter((x) => Number.isFinite(x) && x > 0);
  if (cfg.trimOutliers) d = d.filter((x) => x >= MIN_VALID_SERVICE_MINUTES && x <= MAX_VALID_SERVICE_MINUTES);
  d.sort((a, b) => a - b);
  const n = d.length;
  if (cfg.trimOutliers && n >= 10) {
    const cut = Math.floor(n * TRIM_FRACTION);
    d = d.slice(cut, n - cut);
  }
  if (!d.length) return { n: 0, average: 0, median: 0, p25: 0, p75: 0, p90: 0 };
  return {
    n,
    average: d.reduce((a, b) => a + b, 0) / d.length,
    median: percentile(d, 0.5),
    p25: percentile(d, 0.25),
    p75: percentile(d, 0.75),
    p90: percentile(d, 0.9),
  };
}

/** Samples near the given moment: the same weekday and hour ±1, else hour ±1 on any day, else all (needs `min`). */
export function samplesNear(samples: ServiceSample[], at: SampleMoment, min: number): ServiceSample[] {
  const nearHour = (s: ServiceSample) => {
    const diff = Math.abs(s.hour - at.hour);
    return Math.min(diff, 24 - diff) <= 1;
  };
  const sameDay = samples.filter((s) => nearHour(s) && s.dow === at.dow);
  if (sameDay.length >= min) return sameDay;
  const anyDay = samples.filter(nearHour);
  if (anyDay.length >= min) return anyDay;
  return samples;
}

export type ServiceMinutes = {
  /** Minutes one visitor takes; used for the estimate. */
  minutes: number;
  /** Typical short and long service (p25 / p75), for the range. */
  low: number;
  high: number;
  /** What produced it. `learning` = analytics mode without enough samples yet (the reason's own time is used). */
  source: "fixed" | "reason" | "analytics" | "learning";
  /** Samples behind it (analytics mode). */
  n: number;
};

function spreadOf(minutes: number) {
  return { low: minutes * (1 - DEFAULT_SPREAD), high: minutes * (1 + DEFAULT_SPREAD) };
}

/**
 * Minutes one visitor takes for a reason, by mode: a fixed number, the reason's own expected time, or learned from
 * completed services (falls back to the reason's time until `minSamples` valid samples exist).
 */
export function resolveServiceMinutes(
  cfg: ServiceModelConfig,
  reasonExpected: number,
  samples: ServiceSample[] = [],
  at?: SampleMoment,
): ServiceMinutes {
  if (cfg.mode === "fixed") {
    const m = cfg.fixedMinutesPerVisitor;
    return { minutes: m, ...spreadOf(m), source: "fixed", n: 0 };
  }
  if (cfg.mode === "analytics") {
    const pool = cfg.weightByHour && at ? samplesNear(samples, at, cfg.minSamples) : samples;
    const s = summarizeSamples(
      pool.map((x) => x.minutes),
      cfg,
    );
    if (s.n >= Math.max(1, cfg.minSamples)) {
      const stat = cfg.statistic === "average" ? s.average : cfg.statistic === "p75" ? s.p75 : s.median;
      const minutes = Math.max(0.5, stat);
      return {
        minutes,
        low: Math.min(minutes, Math.max(0.5, s.p25)),
        high: Math.max(minutes, s.p75),
        source: "analytics",
        n: s.n,
      };
    }
    return { minutes: reasonExpected, ...spreadOf(reasonExpected), source: "learning", n: s.n };
  }
  return { minutes: reasonExpected, ...spreadOf(reasonExpected), source: "reason", n: 0 };
}

export type WaitShapeConfig = {
  divideByAgents: boolean;
  /** Round up to a multiple of this many minutes (1, 5 or 10). */
  rounding: number;
  /** Safety margin added on top, in percent. */
  bufferPercent: number;
};

export type WaitEstimate = { minutes: number; low: number; high: number };

/** Estimated wait for a visitor with `ahead` people in front, in whole minutes (rounded up to the configured step). */
export function estimateWait(
  ahead: number,
  servingAgents: number,
  perVisitor: number | { minutes: number; low?: number; high?: number },
  cfg: WaitShapeConfig,
): WaitEstimate {
  if (ahead <= 0) return { minutes: 0, low: 0, high: 0 };
  const pv = typeof perVisitor === "number" ? { minutes: perVisitor } : perVisitor;
  const agents = cfg.divideByAgents ? Math.max(1, servingAgents) : 1;
  const factor = (ahead / agents) * (1 + Math.max(0, cfg.bufferPercent) / 100);
  const step = Math.max(1, cfg.rounding);
  const up = (m: number) => Math.max(step, Math.ceil(Math.round(m * 1e6) / 1e6 / step) * step);
  const minutes = up(factor * Math.max(0.5, pv.minutes));
  const low = Math.min(minutes, up(factor * Math.max(0.5, pv.low ?? pv.minutes)));
  const high = Math.max(minutes, up(factor * Math.max(0.5, pv.high ?? pv.minutes)));
  return { minutes, low, high };
}

export type WaitDisplayConfig = {
  showOnTicket: boolean;
  showAsRange: boolean;
  /** Below this many minutes the visitor is told they are next instead of a number (0 = always the number). */
  minShown: number;
  label: Record<string, string>;
  disclaimer: Record<string, string>;
  nextText: Record<string, string>;
  unitLabel: Record<string, string>;
};

/** What to show for an estimate: the value text ("10–15 min" or "within minutes") or null when nothing is shown. */
export function waitValueText(
  e: WaitEstimate,
  cfg: Pick<WaitDisplayConfig, "showAsRange" | "minShown" | "nextText" | "unitLabel">,
  pick: (text: Record<string, string>) => string,
  digits: (n: number) => string = String,
): { next: boolean; text: string } {
  if (cfg.minShown > 0 && e.minutes < cfg.minShown) return { next: true, text: pick(cfg.nextText) };
  const unit = pick(cfg.unitLabel);
  const value = cfg.showAsRange && e.high > e.low ? `${digits(e.low)}–${digits(e.high)}` : digits(e.minutes);
  return { next: false, text: unit ? `${value} ${unit}` : value };
}

/**
 * Estimated wait for a visitor of a reason served in halls (D62): visitors are taken `capacity` at a time, so
 * `ceil(ahead / capacity)` sessions run first; with several halls working in parallel they share those sessions.
 * `perSession` is the session length (the reason's expected minutes, or learned from completed hall visits).
 */
export function estimateHallWait(
  ahead: number,
  capacity: number,
  halls: number,
  perSession: number | { minutes: number; low?: number; high?: number },
  cfg: Pick<WaitShapeConfig, "rounding" | "bufferPercent">,
): WaitEstimate {
  if (ahead <= 0) return { minutes: 0, low: 0, high: 0 };
  const sessions = Math.ceil(ahead / Math.max(1, capacity));
  const rounds = Math.ceil(sessions / Math.max(1, halls));
  // Same maths as the desk estimate with "agents = 1" and the number of rounds in front of the visitor.
  return estimateWait(rounds, 1, perSession, { ...cfg, divideByAgents: false });
}
