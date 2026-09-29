import { describe, expect, it } from "vitest";
import { generateArrivals, simulate } from "@/domain/simulation/simulate";

/** Engine performance guard: a busy day (1,000 tickets, 20 agents) must simulate quickly in every mode. */
describe("engine at target load", () => {
  const agents = Array.from({ length: 20 }, (_, i) => ({
    id: `a${String(i).padStart(2, "0")}`,
    maxConcurrent: 1,
    weight: 1 + (i % 3),
    skills: { r1: { proficiency: 3 + (i % 3), isPrimary: true }, r2: { proficiency: 3, isPrimary: i % 2 === 0 } },
  }));
  const reasons = [
    { id: "r1", slaMinutes: 10, expectedMinutes: 8 },
    { id: "r2", slaMinutes: 15, expectedMinutes: 12 },
  ];
  const arrivals = generateArrivals(
    { open: [480, 960], total: 1000, reasonMix: { r1: 2, r2: 1 }, priorityMix: { vip: 0.02 } },
    1,
  );

  it.each(["pull", "push", "hybrid"] as const)("%s mode serves everyone within the time budget", (mode) => {
    const t0 = performance.now();
    const r = simulate({
      reasons,
      agents,
      arrivals,
      priorities: { vip: { weight: 100, isLane: true } },
      config: { mode, push: { strategies: ["weighted", "least_waiting"] } },
      seed: 1,
    });
    const ms = performance.now() - t0;
    expect(r.totals.served).toBe(1000);
    expect(ms).toBeLessThan(5000);
    console.log(
      `${mode}: ${Math.round(ms)} ms, avg wait ${r.totals.avgWait} min, SLA ${r.totals.slaPercent}%, fairness ${r.fairness}`,
    );
  });
});
