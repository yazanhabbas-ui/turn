/**
 * Fixed-window rate limiter. Counters live in this process's memory, so limits are per node and reset on restart; a
 * shared store can be plugged in with `setRateLimitStore` (none ships yet: REDIS_URL is not used, see the security
 * review). The system is designed as a single node.
 */
export interface RateLimitStore {
  /** Increments the counter for `key` in the current window and returns the new count and window reset time. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
      this.lastSweep = now;
    }
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return { count: b.count, resetAt: b.resetAt };
  }
}

const g = globalThis as unknown as { __dorRateStore?: RateLimitStore };

export function setRateLimitStore(store: RateLimitStore) {
  g.__dorRateStore = store;
}

function store(): RateLimitStore {
  return (g.__dorRateStore ??= new MemoryRateLimitStore());
}

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number; remaining: number };

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await store().hit(key, windowMs);
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}
