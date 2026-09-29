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
