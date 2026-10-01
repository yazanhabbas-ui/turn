/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API under test are untyped here */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Stats } from "./http";
import { percentile } from "./http";
import type { Check } from "./invariants";
import type { Profile } from "./scenario";

export type ProbeSummary = {
  samples: number;
  loopMeanMs: number;
  loopP99P95Ms: number;
  loopMaxMs: number;
  rssStartMb: number;
  rssEndMb: number;
  rssMaxMb: number;
  rssGrowthMb: number;
  heapGrowthMb: number;
  poolMax: number | null;
  poolTotalMax: number;
  poolWaitingMax: number;
  poolSaturatedPct: number;
};

export function summarizeProbe(file: string, since?: string): ProbeSummary | null {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as any)
    .filter((r) => !since || r.at >= since);
  if (rows.length < 3) return null;
  const warm = rows[Math.floor(rows.length * 0.2)]; // growth is measured after the warm-up (first fifth)
  const last = rows[rows.length - 1];
  const p99s = rows.map((r) => r.loopP99Ms as number).sort((a, b) => a - b);
  const pools = rows.map((r) => r.pool).filter(Boolean) as { total: number; idle: number; waiting: number; max: number | null }[];
  const max = pools[0]?.max ?? null;
  return {
    samples: rows.length,
    loopMeanMs: rows.reduce((a, r) => a + r.loopMeanMs, 0) / rows.length,
    loopP99P95Ms: percentile(p99s, 95),
    loopMaxMs: Math.max(...rows.map((r) => r.loopMaxMs as number)),
    rssStartMb: rows[0].rssMb,
    rssEndMb: last.rssMb,
    rssMaxMb: Math.max(...rows.map((r) => r.rssMb as number)),
    rssGrowthMb: last.rssMb - warm.rssMb,
    heapGrowthMb: last.heapMb - warm.heapMb,
    poolMax: max,
    poolTotalMax: Math.max(0, ...pools.map((p) => p.total)),
    poolWaitingMax: Math.max(0, ...pools.map((p) => p.waiting)),
    poolSaturatedPct: pools.length
      ? (100 * pools.filter((p) => p.waiting > 0 || (max !== null && p.total >= max && p.idle === 0)).length) / pools.length
      : 0,
  };
}

export type Thresholds = {
  p95Ms: Record<string, number>;
  defaultP95Ms: number;
  errorRatePct: number;
  deliveryP95Ms: number;
  loopP99Ms: number;
  rssGrowthMb: number;
};

/** Pass thresholds. LOAD_THRESHOLD_FACTOR (e.g. 2) relaxes every latency limit on a slow machine (default 5 for smoke, 1 for full). */
export function thresholds(profileName = "full"): Thresholds {
  // The smoke run is a regression gate for correctness and gross slowdowns on any CI runner, so its latency limits are
  // 5x looser; the full profile is judged against the stated limits.
  const f = Number(process.env.LOAD_THRESHOLD_FACTOR ?? (profileName === "smoke" ? 5 : 1));
  const t = (n: number) => Math.round(n * f);
  return {
    p95Ms: {
      issue: t(500),
      "call-next": t(500),
      start: t(500),
      complete: t(500),
      "reports-export-csv": t(5000),
      "visitor-page": t(2000),
      health: t(500),
    },
    defaultP95Ms: t(1000),
    errorRatePct: 0.5,
    deliveryP95Ms: t(1000),
    loopP99Ms: t(250),
    rssGrowthMb: Number(process.env.LOAD_MAX_RSS_GROWTH_MB ?? 300),
  };
}

export type Verdict = { name: string; ok: boolean; detail: string };

export type Report = {
  profile: Profile;
  startedAt: string;
  baseUrl: string;
  ownInstance: boolean;
  machine: string;
  loadSeconds: number;
  drainSeconds: number;
  drained: boolean;
  issued: number;
  completed: number;
  throughputPerMin: number;
  endpoints: Record<string, ReturnType<Stats["summary"]>>;
  delivery: { samples: number; p50: number; p95: number; p99: number; max: number };
  sockets: { expected: number; connected: number; errors: string[] };
  probe: ProbeSummary | null;
  invariants: Check[];
  verdicts: Verdict[];
  failureSamples: Record<string, string[]>;
  passed: boolean;
};

export function evaluate(r: Omit<Report, "verdicts" | "passed">, th: Thresholds): Verdict[] {
  const v: Verdict[] = [];
  for (const [group, s] of Object.entries(r.endpoints)) {
    if (["login"].includes(group)) continue;
    const limit = th.p95Ms[group] ?? th.defaultP95Ms;
    v.push({
      name: `p95 ${group}`,
      ok: s.p95 <= limit,
      detail: `${s.p95.toFixed(0)} ms (limit ${limit} ms, ${s.requests} requests)`,
    });
  }
  const total = Object.values(r.endpoints).reduce((a, s) => a + s.requests, 0);
  const bad = Object.values(r.endpoints).reduce((a, s) => a + s.failed + s.rateLimited, 0);
  const rate = total ? (100 * bad) / total : 0;
  v.push({
    name: "error rate",
    ok: rate < th.errorRatePct,
    detail: `${rate.toFixed(3)} % (${bad} of ${total} requests failed or were rate limited; limit ${th.errorRatePct} %)`,
  });
  v.push({
    name: "sockets connected",
    ok: r.sockets.connected === r.sockets.expected,
    detail: `${r.sockets.connected} of ${r.sockets.expected}${r.sockets.errors[0] ? `; first error: ${r.sockets.errors[0]}` : ""}`,
  });
  v.push({
    name: "ticket.called reaches the screens",
    ok: r.delivery.samples > 0 && r.delivery.p95 <= th.deliveryP95Ms,
    detail: `p50 ${r.delivery.p50.toFixed(0)} / p95 ${r.delivery.p95.toFixed(0)} / p99 ${r.delivery.p99.toFixed(0)} ms from the call request, ${r.delivery.samples} deliveries (limit p95 ${th.deliveryP95Ms} ms)`,
  });
  if (r.probe) {
    v.push({
      name: "event-loop lag",
      ok: r.probe.loopP99P95Ms <= th.loopP99Ms,
      detail: `p99 per second, 95th percentile ${r.probe.loopP99P95Ms.toFixed(0)} ms, worst ${r.probe.loopMaxMs.toFixed(0)} ms (limit ${th.loopP99Ms} ms)`,
    });
    v.push({
      name: "memory growth",
      ok: r.probe.rssGrowthMb <= th.rssGrowthMb,
      detail: `RSS ${r.probe.rssGrowthMb.toFixed(0)} MB since warm-up (limit ${th.rssGrowthMb} MB), heap ${r.probe.heapGrowthMb.toFixed(0)} MB`,
    });
  }
  for (const c of r.invariants) v.push({ name: `invariant: ${c.name}`, ok: c.ok, detail: c.detail });
  return v;
}

const ms = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

export function toMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Load test: ${r.profile.name} (${r.passed ? "PASSED" : "FAILED"})`, "");
  lines.push(`- Started: ${r.startedAt}`);
  lines.push(`- Target: ${r.baseUrl} (${r.ownInstance ? "private instance started by the test" : "external instance"})`);
  lines.push(`- Machine: ${r.machine}`);
  lines.push(
    `- Load: ${r.profile.agents} agents, ${r.profile.ratePerMin} tickets/min for ${r.loadSeconds.toFixed(0)} s, ${r.profile.visitors} visitor pollers, ${r.profile.displays} display sockets, ${r.profile.wallboards} wallboards, distribution mode ${r.profile.mode}`,
  );
  lines.push(
    `- Result: ${r.issued} tickets issued, ${r.completed} completed, queue ${r.drained ? "drained" : "NOT drained"} after ${r.drainSeconds.toFixed(0)} s, ${r.throughputPerMin.toFixed(0)} completed per minute overall`,
    "",
  );
  lines.push("## Checks", "", "| Check | Result | Detail |", "| --- | --- | --- |");
  for (const v of r.verdicts) lines.push(`| ${v.name} | ${v.ok ? "pass" : "**FAIL**"} | ${v.detail.replace(/\|/g, "/")} |`);
  lines.push(
    "",
    "## Request latency (ms)",
    "",
    "| Endpoint | Requests | Failed | 429 | p50 | p95 | p99 | max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [g, s] of Object.entries(r.endpoints)) {
    lines.push(
      `| ${g} | ${s.requests} | ${s.failed} | ${s.rateLimited} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} |`,
    );
  }
  if (r.probe) {
    const p = r.probe;
    lines.push("", "## Inside the app process (sampled once a second)", "");
    lines.push(
      `- Event-loop delay: mean ${p.loopMeanMs.toFixed(1)} ms, p99 per second (95th percentile) ${p.loopP99P95Ms.toFixed(1)} ms, worst ${p.loopMaxMs.toFixed(1)} ms`,
    );
    lines.push(
      `- Memory: RSS ${p.rssStartMb.toFixed(0)} MB at start, ${p.rssEndMb.toFixed(0)} MB at end, peak ${p.rssMaxMb.toFixed(0)} MB; growth since warm-up ${p.rssGrowthMb.toFixed(0)} MB (heap ${p.heapGrowthMb.toFixed(0)} MB)`,
    );
    lines.push(
      `- PostgreSQL pool: up to ${p.poolTotalMax} of ${p.poolMax ?? "?"} connections open, most queries waiting for a connection ${p.poolWaitingMax}, saturated in ${p.poolSaturatedPct.toFixed(1)} % of samples`,
    );
  }
  const failures = Object.entries(r.failureSamples);
  if (failures.length) {
    lines.push("", "## Failure samples", "");
    for (const [g, list] of failures) for (const f of list) lines.push(`- ${g}: ${f}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(r: Report, dir: string): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = r.startedAt.replace(/[:.]/g, "-");
  const base = path.join(dir, `${r.profile.name}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${base}.md`, toMarkdown(r));
  writeFileSync(path.join(dir, `${r.profile.name}-latest.json`), JSON.stringify(r, null, 2));
  writeFileSync(path.join(dir, `${r.profile.name}-latest.md`), toMarkdown(r));
  return { json: `${base}.json`, md: `${base}.md` };
}
