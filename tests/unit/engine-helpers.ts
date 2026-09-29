import { resolveConfig, type PartialDistributionConfig } from "@/domain/distribution/config";
import type { EngineAgent, EngineSnapshot, EngineTicket } from "@/domain/distribution/types";

export const T0 = Date.UTC(2026, 8, 29, 7, 0); // 10:00 in Riyadh
export const min = (n: number) => n * 60_000;

let seq = 0;
export function ticket(p: Partial<EngineTicket> = {}): EngineTicket {
  seq++;
  return {
    id: p.id ?? `t${String(seq).padStart(3, "0")}`,
    queueId: "qA",
    reasonId: "rA",
    status: "WAITING",
    priorityKey: null,
    assignedAgentId: null,
    assignedAt: null,
    queuedAt: T0,
    appointmentAt: null,
    lastAgentId: null,
    servingAgentId: null,
    ...p,
  };
}

export function agent(id: string, p: Partial<EngineAgent> & { reasons?: Record<string, [number, boolean]> } = {}): EngineAgent {
  const { reasons = { rA: [3, true] }, ...rest } = p;
  return {
    id,
    status: "AVAILABLE",
    maxConcurrent: 1,
    weight: 1,
    idleSince: T0 - min(5),
    lastAssignedAt: null,
    handledToday: 0,
    skills: new Map(Object.entries(reasons).map(([r, [proficiency, isPrimary]]) => [r, { proficiency, isPrimary }])),
    ...rest,
  };
}

export function snapshot(
  p: Partial<EngineSnapshot> & { config?: PartialDistributionConfig; perQueue?: Record<string, PartialDistributionConfig> } = {},
): EngineSnapshot {
  const { config = {}, perQueue = {}, ...rest } = p;
  const cache = new Map<string, ReturnType<typeof resolveConfig>>();
  return {
    now: T0,
    tickets: [],
    agents: [],
    reasons: new Map([
      ["rA", { id: "rA", slaMinutes: 15, expectedMinutes: 10 }],
      ["rB", { id: "rB", slaMinutes: 30, expectedMinutes: 20 }],
    ]),
    priorities: new Map([
      ["normal", { weight: 0, isLane: false }],
      ["elderly", { weight: 50, isLane: false }],
      ["vip", { weight: 100, isLane: true }],
    ]),
    configFor: (q) => {
      if (!cache.has(q)) cache.set(q, resolveConfig(config, perQueue[q]));
      return cache.get(q)!;
    },
    random: mulberry(42),
    ...rest,
  };
}

/** Small seeded PRNG for deterministic tests. */
export function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
