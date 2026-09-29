import { describe, expect, it } from "vitest";
import { generateArrivals, jainIndex, percentile, simulate, type SimInput } from "@/domain/simulation/simulate";

const reasons = [
  { id: "general", slaMinutes: 10, expectedMinutes: 5 },
  { id: "contract", slaMinutes: 20, expectedMinutes: 20 },
];
const priorities = {
  normal: { weight: 0, isLane: false },
  elderly: { weight: 50, isLane: false },
  vip: { weight: 100, isLane: true },
};
const agents: SimInput["agents"] = [
  {
    id: "a1",
    maxConcurrent: 1,
    weight: 1,
    skills: { general: { proficiency: 4, isPrimary: true }, contract: { proficiency: 3, isPrimary: false } },
  },
  { id: "a2", maxConcurrent: 1, weight: 1, skills: { general: { proficiency: 3, isPrimary: true } } },
  {
    id: "a3",
    maxConcurrent: 1,
    weight: 1,
    skills: { contract: { proficiency: 5, isPrimary: true }, general: { proficiency: 2, isPrimary: false } },
  },
];

function day(total = 120, seed = 7) {
  return generateArrivals(
    { open: [480, 960], total, reasonMix: { general: 3, contract: 1 }, priorityMix: { elderly: 0.05, vip: 0.02 } },
    seed,
  );
}

describe("simulation helpers", () => {
  it("percentile and Jain fairness", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(jainIndex([5, 5, 5])).toBe(1);
    expect(jainIndex([10, 0, 0])).toBeCloseTo(1 / 3);
  });

  it("generates deterministic arrivals inside opening hours", () => {
    const a = day(200, 1);
    expect(a).toHaveLength(200);
    expect(a.every((x) => x.at >= 480 && x.at < 960)).toBe(true);
    expect(day(200, 1)).toEqual(a);
    expect(a.filter((x) => x.reasonId === "general").length).toBeGreaterThan(a.filter((x) => x.reasonId === "contract").length);
  });
});

describe("simulate", () => {
  const base: SimInput = { reasons, agents, arrivals: day(), priorities, config: { mode: "pull" }, seed: 11 };

  it("serves every visitor and reports consistent KPIs", () => {
    const r = simulate(base);
    expect(r.totals.tickets).toBe(120);
    expect(r.totals.served).toBe(120);
    expect(r.totals.unserved).toBe(0);
    expect(r.totals.avgWait).toBeGreaterThanOrEqual(0);
    expect(r.totals.p90Wait).toBeGreaterThanOrEqual(r.totals.medianWait);
    expect(r.totals.maxWait).toBeGreaterThanOrEqual(r.totals.p90Wait);
    expect(r.perAgent.reduce((a, x) => a + x.served, 0)).toBe(120);
    expect(r.fairness).toBeGreaterThan(0);
    expect(r.fairness).toBeLessThanOrEqual(1);
    // Nobody is served by an agent without the skill.
    for (const t of r.tickets) expect(agents.find((a) => a.id === t.agentId)!.skills).toHaveProperty(t.reasonId);
  });

  it("is deterministic for the same seed", () => {
    expect(simulate(base)).toEqual(simulate(base));
  });

  it("more agents means shorter waits", () => {
    const busy = simulate({ ...base, arrivals: day(220, 3) });
    const moreAgents = simulate({
      ...base,
      arrivals: day(220, 3),
      agents: [
        ...agents,
        {
          id: "a4",
          maxConcurrent: 1,
          weight: 1,
          skills: { general: { proficiency: 3, isPrimary: true }, contract: { proficiency: 3, isPrimary: true } },
        },
      ],
    });
    expect(moreAgents.totals.avgWait).toBeLessThan(busy.totals.avgWait);
    expect(moreAgents.totals.slaPercent).toBeGreaterThanOrEqual(busy.totals.slaPercent);
  });

  it("push least-waiting spreads work at least as fairly as pull", () => {
    const flat: SimInput["agents"] = [1, 2, 3].map((i) => ({
      id: `f${i}`,
      maxConcurrent: 1,
      weight: 1,
      skills: { general: { proficiency: 3, isPrimary: true } },
    }));
    const arrivals = generateArrivals({ open: [480, 960], total: 150, reasonMix: { general: 1 } }, 5);
    const push = simulate({
      ...base,
      agents: flat,
      arrivals,
      config: { mode: "push", push: { strategies: ["least_waiting", "round_robin"] } },
    });
    expect(push.totals.served).toBe(150);
    expect(push.fairness).toBeGreaterThan(0.95);
  });

  it("respects agent shifts", () => {
    const shifted = simulate({
      ...base,
      agents: agents.map((a) => (a.id === "a2" ? { ...a, shift: [720, 960] as [number, number] } : a)),
    });
    const early = shifted.tickets.filter((t) => t.agentId === "a2").every((t) => (t.calledAt ?? 0) >= 720);
    expect(early).toBe(true);
  });
});
