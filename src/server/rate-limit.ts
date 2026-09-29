/**
 * Fixed-window rate limiter. The in-memory store is the single-node default; a Redis store is plugged in
 * automatically when REDIS_URL is set (see src/server/redis.ts, added with the realtime milestone).
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
