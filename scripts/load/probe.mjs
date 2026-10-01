/**
 * Preloaded into the app process by the load tests (node --import probe.mjs server.ts). Samples once a second, without
 * touching any application code, and appends one JSON line per sample to $LOAD_PROBE_FILE:
 *   event-loop delay (mean / p99 / max, ms), memory (rss, heapUsed, MB) and the PostgreSQL pool
 *   (connections open / idle / queries waiting for a free connection).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

const file = process.env.LOAD_PROBE_FILE;
if (file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const started = Date.now();
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const pool = globalThis.__dorPool;
    const line = {
      t: Date.now() - started,
      at: new Date().toISOString(),
      loopMeanMs: histogram.mean / 1e6,
      loopP99Ms: histogram.percentile(99) / 1e6,
      loopMaxMs: histogram.max / 1e6,
      rssMb: mem.rss / 1048576,
      heapMb: mem.heapUsed / 1048576,
      pool: pool
        ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max ?? null }
        : null,
    };
    histogram.reset();
    try {
      appendFileSync(file, JSON.stringify(line) + "\n");
    } catch {
      // the results folder is gone: stop sampling
      clearInterval(timer);
    }
  }, 1000);
  timer.unref();
}
