/**
 * Server time source. Everything time-dependent in the queue (hours, timeouts, aging) reads it here, so tests
 * and the simulator-style integration tests can travel in time. Production never overrides it.
 */
let override: number | null = null;

export function now(): number {
  return override ?? Date.now();
}

export function setClock(ms: number | null) {
  override = ms;
}

export function advanceClock(minutes: number) {
  override = now() + minutes * 60_000;
}
