import { resolveConfig, toEngineConfig, type DistributionConfig, type PartialDistributionConfig } from "../distribution/config";
import { dispatch, expiredReservations, selectTicketForAgent } from "../distribution/engine";
import type { EngineAgent, EngineSnapshot, EngineTicket, PriorityInfo } from "../distribution/types";

/**
 * Discrete-event simulation of one service day using the production engine (ordering, eligibility, push
 * strategies, hybrid releases). Deterministic for a given seed, so two configurations can be compared fairly
 * on exactly the same arrivals and service times.
 */

export type SimReason = { id: string; slaMinutes: number; expectedMinutes: number };
export type SimAgent = {
  id: string;
  maxConcurrent: number;
  weight: number;
  skills: Record<string, { proficiency: number; isPrimary: boolean }>;
  /** Working window in minutes from the start of the day (default: the whole day). */
  shift?: [number, number];
};
export type SimArrival = {
  at: number;
  reasonId: string;
  priorityKey?: string | null;
  lastAgentId?: string | null;
  appointmentAt?: number | null;
};

export type SimInput = {
  reasons: SimReason[];
  agents: SimAgent[];
  arrivals: SimArrival[];
  priorities: Record<string, PriorityInfo>;
  /** Global config plus optional per-reason overrides (queue = reason in a single-branch simulation). */
  config: PartialDistributionConfig;
  perReason?: Record<string, PartialDistributionConfig>;
  seed: number;
  /** Coefficient of variation of service time (lognormal). */
  serviceVariability?: number;
  /** Minutes between call and service start (walking to the desk). */
  walkMinutes?: number;
  /** Proficiency speeds service: time × (1 + (3 − proficiency) × this). 0 disables. */
  proficiencySpeedFactor?: number;
};

export type SimTicketResult = {
  id: string;
  reasonId: string;
  arrivedAt: number;
  calledAt: number | null;
  agentId: string | null;
  waitMinutes: number | null;
};

export type SimResult = {
  totals: {
    tickets: number;
    served: number;
    unserved: number;
    avgWait: number;
    medianWait: number;
    p90Wait: number;
    maxWait: number;
    slaPercent: number;
  };
  perReason: { reasonId: string; tickets: number; avgWait: number; p90Wait: number; slaPercent: number }[];
  perAgent: { agentId: string; served: number; busyMinutes: number; utilisation: number }[];
  /** Jain's fairness index over weight-normalised load (1 = perfectly fair). */
  fairness: number;
  /** Waiting tickets sampled every 15 minutes. */
  queueLength: { minute: number; waiting: number }[];
  tickets: SimTicketResult[];
};

const MIN = 60_000;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lognormal(rng: () => number, mean: number, cv: number): number {
  if (cv <= 0) return mean;
  const sigma2 = Math.log(1 + cv * cv);
  const mu = Math.log(mean) - sigma2 / 2;
  const u1 = Math.max(rng(), 1e-12);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
  return Math.exp(mu + Math.sqrt(sigma2) * z);
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function jainIndex(values: number[]): number {
  if (!values.length) return 1;
  const sum = values.reduce((a, b) => a + b, 0);
  const sq = values.reduce((a, b) => a + b * b, 0);
  return sq === 0 ? 1 : (sum * sum) / (values.length * sq);
}

const round = (n: number) => Math.round(n * 10) / 10;

export function simulate(input: SimInput): SimResult {
  const rng = mulberry32(input.seed);
  // Pre-draw service times per arrival so every configuration sees identical work.
  const serviceRng = mulberry32(input.seed ^ 0x9e3779b9);
  const reasons = new Map(input.reasons.map((r) => [r.id, r]));
  const cfgCache = new Map<string, DistributionConfig>();
  const configFor = (queueId: string) => {
    if (!cfgCache.has(queueId)) cfgCache.set(queueId, toEngineConfig(resolveConfig(input.config, input.perReason?.[queueId])));
    return cfgCache.get(queueId)!;
  };
  const walk = input.walkMinutes ?? 0.5;
  const cv = input.serviceVariability ?? 0.5;
  const speed = input.proficiencySpeedFactor ?? 0.1;

  const arrivals = [...input.arrivals].sort((a, b) => a.at - b.at);
  const baseService = arrivals.map((a) => lognormal(serviceRng, reasons.get(a.reasonId)?.expectedMinutes ?? 10, cv));

  const agents: EngineAgent[] = input.agents.map((a) => ({
    id: a.id,
    status: "OFFLINE",
    maxConcurrent: a.maxConcurrent,
    weight: a.weight,
    idleSince: null,
    lastAssignedAt: null,
    handledToday: 0,
    skills: new Map(Object.entries(a.skills)),
  }));
  const shifts = new Map(input.agents.map((a) => [a.id, a.shift ?? [-Infinity, Infinity]]));
  /** Only non-finished tickets live in the snapshot, so engine work stays proportional to the live queue. */
  const tickets: EngineTicket[] = [];
  const byId = new Map<string, EngineTicket>();
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const results = new Map<string, SimTicketResult>();
  const busy = new Map(input.agents.map((a) => [a.id, 0]));
  const served = new Map(input.agents.map((a) => [a.id, 0]));
  const completions: { at: number; ticketId: string; agentId: string }[] = [];
  const snapshot: EngineSnapshot = {
    now: 0,
    tickets,
    agents,
    reasons: new Map(input.reasons.map((r) => [r.id, r])),
    priorities: new Map(Object.entries(input.priorities)),
    configFor,
    lastAssignedAgentByQueue: new Map(),
    random: rng,
  };

  const lastArrival = arrivals.at(-1)?.at ?? 0;
  const horizon = lastArrival + 24 * 60; // Allow the queue to drain.
  const sampleEvery = 15;
  const queueLength: { minute: number; waiting: number }[] = [];
  let nextSample = Math.floor((arrivals[0]?.at ?? 0) / sampleEvery) * sampleEvery;
  let ai = 0;
  let t = arrivals[0]?.at ?? 0;

  const setShiftStatuses = (minute: number) => {
    for (const a of agents) {
      const [s, e] = shifts.get(a.id)!;
      const on = minute >= s && minute < e;
      if (on && a.status === "OFFLINE") {
        a.status = "AVAILABLE";
        a.idleSince = minute * MIN;
      } else if (!on && a.status !== "OFFLINE") a.status = "OFFLINE";
    }
  };

  for (let guard = 0; guard < 200_000; guard++) {
    snapshot.now = t * MIN;
    setShiftStatuses(t);

    // Completions due now.
    for (let i = completions.length - 1; i >= 0; i--) {
      const c = completions[i];
      if (c.at > t + 1e-9) continue;
      completions.splice(i, 1);
      const tk = byId.get(c.ticketId)!;
      tk.status = "COMPLETED";
      byId.delete(tk.id);
      tickets.splice(tickets.indexOf(tk), 1);
      const agent = agentById.get(c.agentId)!;
      if (!completions.some((x) => x.agentId === agent.id)) agent.idleSince = snapshot.now;
    }

    // Arrivals due now.
    while (ai < arrivals.length && arrivals[ai].at <= t + 1e-9) {
      const a = arrivals[ai];
      const id = `s${ai}`;
      const tk: EngineTicket = {
        id,
        queueId: a.reasonId,
        reasonId: a.reasonId,
        status: "WAITING",
        priorityKey: a.priorityKey ?? null,
        assignedAgentId: null,
        assignedAt: null,
        queuedAt: a.at * MIN,
        appointmentAt: a.appointmentAt != null ? a.appointmentAt * MIN : null,
        lastAgentId: a.lastAgentId ?? null,
        servingAgentId: null,
      };
      tickets.push(tk);
      byId.set(id, tk);
      results.set(id, { id, reasonId: a.reasonId, arrivedAt: a.at, calledAt: null, agentId: null, waitMinutes: null });
      ai++;
    }

    // Release expired reservations, reserve new ones, then let every free agent call next.
    for (const r of expiredReservations(snapshot)) {
      const tk = byId.get(r.ticketId)!;
      tk.assignedAgentId = null;
      tk.assignedAt = null;
    }
    dispatch(snapshot);
    const order = [...agents].sort((a, b) => (a.idleSince ?? Infinity) - (b.idleSince ?? Infinity) || a.id.localeCompare(b.id));
    for (const agent of order) {
      for (;;) {
        const d = selectTicketForAgent(snapshot, agent.id);
        if (!d.ticket) break;
        const tk = d.ticket;
        tk.status = "SERVING";
        tk.servingAgentId = agent.id;
        tk.assignedAgentId = agent.id;
        agent.lastAssignedAt = snapshot.now;
        agent.handledToday++;
        const idx = Number(tk.id.slice(1));
        const prof = agent.skills.get(tk.reasonId)?.proficiency ?? 3;
        const duration = walk + baseService[idx] * Math.max(0.3, 1 + (3 - prof) * speed);
        completions.push({ at: t + duration, ticketId: tk.id, agentId: agent.id });
        busy.set(agent.id, busy.get(agent.id)! + duration);
        served.set(agent.id, served.get(agent.id)! + 1);
        const res = results.get(tk.id)!;
        res.calledAt = t;
        res.agentId = agent.id;
        res.waitMinutes = t - res.arrivedAt;
      }
    }

    while (nextSample <= t) {
      queueLength.push({
        minute: nextSample,
        waiting: tickets.filter((x) => x.status === "WAITING" && x.queuedAt <= nextSample * MIN).length,
      });
      nextSample += sampleEvery;
    }

    // Next event: arrival, completion, shift boundary, or reservation timeout.
    const candidates: number[] = [];
    if (ai < arrivals.length) candidates.push(arrivals[ai].at);
    for (const c of completions) candidates.push(c.at);
    for (const [s, e] of shifts.values()) for (const b of [s, e]) if (Number.isFinite(b) && b > t) candidates.push(b);
    for (const tk of tickets) {
      if (tk.status === "WAITING" && tk.assignedAt !== null)
        candidates.push(tk.assignedAt / MIN + configFor(tk.queueId).hybrid.acceptTimeoutMinutes);
    }
    const waitingLeft = tickets.some((x) => x.status === "WAITING");
    const future = candidates.filter((c) => c > t + 1e-9);
    if (!future.length || t > horizon) break;
    if (!waitingLeft && ai >= arrivals.length && !completions.length) break;
    t = Math.min(...future);
  }

  const all = [...results.values()];
  const waits = all
    .filter((r) => r.waitMinutes !== null)
    .map((r) => r.waitMinutes!)
    .sort((a, b) => a - b);
  const slaOk = (rs: SimTicketResult[]) =>
    rs.filter((r) => r.waitMinutes !== null && r.waitMinutes <= (reasons.get(r.reasonId)?.slaMinutes ?? Infinity)).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const shiftMinutes = (id: string) => {
    const [s, e] = shifts.get(id)!;
    const first = arrivals[0]?.at ?? 0;
    const end = Math.max(lastArrival, ...completions.map((c) => c.at));
    return Math.max(1, Math.min(e, end) - Math.max(s, first));
  };

  return {
    totals: {
      tickets: all.length,
      served: waits.length,
      unserved: all.length - waits.length,
      avgWait: round(avg(waits)),
      medianWait: round(percentile(waits, 0.5)),
      p90Wait: round(percentile(waits, 0.9)),
      maxWait: round(waits.at(-1) ?? 0),
      slaPercent: all.length ? round((slaOk(all) / all.length) * 100) : 100,
    },
    perReason: input.reasons.map((r) => {
      const rs = all.filter((x) => x.reasonId === r.id);
      const w = rs
        .filter((x) => x.waitMinutes !== null)
        .map((x) => x.waitMinutes!)
        .sort((a, b) => a - b);
      return {
        reasonId: r.id,
        tickets: rs.length,
        avgWait: round(avg(w)),
        p90Wait: round(percentile(w, 0.9)),
        slaPercent: rs.length ? round((slaOk(rs) / rs.length) * 100) : 100,
      };
    }),
    perAgent: input.agents.map((a) => ({
      agentId: a.id,
      served: served.get(a.id)!,
      busyMinutes: round(busy.get(a.id)!),
      utilisation: round(Math.min(100, (busy.get(a.id)! / (shiftMinutes(a.id) * a.maxConcurrent)) * 100)),
    })),
    fairness: Math.round(jainIndex(input.agents.map((a) => served.get(a.id)! / Math.max(1, a.weight))) * 1000) / 1000,
    queueLength,
    tickets: all,
  };
}

export type ArrivalProfile = {
  /** Opening and closing minute of the day, e.g. [480, 960] for 08:00–16:00. */
  open: [number, number];
  total: number;
  /** Relative weight per reason id. */
  reasonMix: Record<string, number>;
  /** Share of tickets per priority key, e.g. { elderly: 0.05, vip: 0.02 }. */
  priorityMix?: Record<string, number>;
  /** Relative arrival intensity per hour offset from opening (default: morning peak). */
  hourly?: number[];
};

/** Synthetic arrivals for one day following an hourly intensity curve. Deterministic for a seed. */
export function generateArrivals(p: ArrivalProfile, seed: number): SimArrival[] {
  const rng = mulberry32(seed);
  const hours = Math.max(1, Math.ceil((p.open[1] - p.open[0]) / 60));
  const curve = p.hourly ?? [0.7, 1.2, 1.5, 1.3, 0.9, 1.0, 1.1, 0.8, 0.5].slice(0, hours);
  while (curve.length < hours) curve.push(1);
  const curveSum = curve.reduce((a, b) => a + b, 0);
  const reasonEntries = Object.entries(p.reasonMix).filter(([, w]) => w > 0);
  const reasonSum = reasonEntries.reduce((a, [, w]) => a + w, 0);
  const pick = <T>(entries: [T, number][], sum: number) => {
    let x = rng() * sum;
    for (const [k, w] of entries) if ((x -= w) <= 0) return k;
    return entries.at(-1)![0];
  };
  const out: SimArrival[] = [];
  for (let i = 0; i < p.total; i++) {
    const hour = pick(
      curve.map((w, h) => [h, w] as [number, number]),
      curveSum,
    );
    const at = Math.min(p.open[1] - 1, p.open[0] + hour * 60 + rng() * 60);
    let priorityKey: string | null = null;
    let x = rng();
    for (const [k, share] of Object.entries(p.priorityMix ?? {}))
      if ((x -= share) < 0) {
        priorityKey = k;
        break;
      }
    out.push({ at: Math.round(at * 10) / 10, reasonId: pick(reasonEntries, reasonSum), priorityKey });
  }
  return out.sort((a, b) => a.at - b.at);
}
