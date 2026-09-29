import type { DistributionConfig } from "./config";
import type { EngineReason, EngineTicket, PriorityInfo } from "./types";

export type TicketScore = {
  /** 0 = max-wait guarantee breached (served first), 1 = priority lane, 2 = regular line. */
  tier: number;
  score: number;
  queuedAt: number;
};

const MIN = 60_000;

/**
 * Combined score of a waiting ticket. Higher is served first within its tier:
 *   wait × waitWeight + priority × priorityWeight + aging boosts + SLA pressure + appointment boost.
 */
export function scoreTicket(
  t: EngineTicket,
  now: number,
  cfg: DistributionConfig,
  reason: EngineReason | undefined,
  priority: PriorityInfo | undefined,
): TicketScore {
  const o = cfg.ordering;
  const waited = Math.max(0, (now - t.queuedAt) / MIN);
  let score = waited * o.waitWeight + (priority?.weight ?? 0) * o.priorityWeight;

  for (const step of o.aging) if (waited >= step.afterMinutes) score += step.boost;

  if (reason && reason.slaMinutes > 0 && o.slaWeight > 0) {
    // Pressure grows from 50% of the SLA target and steepens after the target is missed.
    const ratio = waited / reason.slaMinutes;
    if (ratio >= 0.5) score += o.slaWeight * (ratio >= 1 ? 20 + (ratio - 1) * 40 : (ratio - 0.5) * 20);
  }

  if (t.appointmentAt !== null && now >= t.appointmentAt - o.appointmentEarlyMinutes * MIN) score += o.appointmentBoost;

  const breached = o.maxWaitMinutes > 0 && waited >= o.maxWaitMinutes;
  const tier = breached ? 0 : o.lanesFirst && priority?.isLane ? 1 : 2;
  return { tier, score, queuedAt: t.queuedAt };
}

/** Comparator: lower tier first, then higher score, then earlier queue time (FIFO), then id for stability. */
export function compareScores(a: TicketScore & { id: string }, b: TicketScore & { id: string }): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  // Inside the "max wait breached" tier, strictly by who has waited longest.
  if (a.tier === 0) return a.queuedAt - b.queuedAt || a.id.localeCompare(b.id);
  if (a.score !== b.score) return b.score - a.score;
  return a.queuedAt - b.queuedAt || a.id.localeCompare(b.id);
}

/** Orders tickets the way agents will receive them. */
export function orderTickets(
  tickets: EngineTicket[],
  now: number,
  cfgFor: (queueId: string) => DistributionConfig,
  reasons: Map<string, EngineReason>,
  priorities: Map<string, PriorityInfo>,
): EngineTicket[] {
  return tickets
    .map((t) => ({
      t,
      s: {
        ...scoreTicket(
          t,
          now,
          cfgFor(t.queueId),
          reasons.get(t.reasonId),
          t.priorityKey ? priorities.get(t.priorityKey) : undefined,
        ),
        id: t.id,
      },
    }))
    .sort((a, b) => compareScores(a.s, b.s))
    .map((x) => x.t);
}
