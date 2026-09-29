import type { PushStrategy } from "./config";
import type { EngineAgent } from "./types";

/**
 * A strategy scores candidate agents; lower rank = better. Strategies are chained: each one keeps only the
 * best-ranked agents from the previous step, so later strategies break ties. Adding a strategy = one entry here.
 */
export type AgentCandidate = { agent: EngineAgent; load: number; proficiency: number };

export type StrategyFn = (c: AgentCandidate, ctx: { random: () => number; now: number }) => number;

export const STRATEGIES: Record<PushStrategy, StrategyFn> = {
  /** Whoever was assigned least recently (never-assigned first). Stateless round robin. */
  round_robin: (c) => c.agent.lastAssignedAt ?? -Infinity,
  /** Fewest active + reserved tickets. */
  least_waiting: (c) => c.load,
  /** Idle agents first, longest idle first. Busy agents rank after all idle ones. */
  longest_idle: (c, { now }) => (c.load === 0 ? (c.agent.idleSince ?? now) : Number.MAX_SAFE_INTEGER / 2 + c.load),
  /** Highest proficiency for this reason first. */
  proficiency: (c) => -c.proficiency,
  /** Fairness by weight: agent with the lowest handled/weight ratio goes next. */
  weighted: (c) => (c.agent.handledToday + c.load) / Math.max(1, c.agent.weight),
  random: (_c, { random }) => random(),
};

/** Applies the strategy chain and returns the chosen agent (or null when there are no candidates). */
export function pickAgent(
  candidates: AgentCandidate[],
  chain: readonly PushStrategy[],
  ctx: { random: () => number; now: number },
): EngineAgent | null {
  let pool = candidates;
  for (const name of chain) {
    if (pool.length <= 1) break;
    const fn = STRATEGIES[name];
    const ranked = pool.map((c) => ({ c, r: fn(c, ctx) }));
    const best = Math.min(...ranked.map((x) => x.r));
    pool = ranked.filter((x) => x.r === best).map((x) => x.c);
  }
  if (!pool.length) return null;
  // Deterministic final tie-break so the same state always gives the same answer.
  return [...pool].sort((a, b) => a.agent.id.localeCompare(b.agent.id))[0].agent;
}
