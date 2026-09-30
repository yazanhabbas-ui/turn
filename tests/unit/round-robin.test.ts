import { describe, expect, it } from "vitest";
import { resolveConfig, toEngineConfig } from "@/domain/distribution/config";
import { dispatch } from "@/domain/distribution/engine";
import { pickAgent } from "@/domain/distribution/strategies";
import { simulate } from "@/domain/simulation/simulate";
import { agent, snapshot, ticket, T0 } from "./engine-helpers";

describe("round robin mode", () => {
  it("is auto-assign with a strict rotation for the engine, and a plain mode for admins", () => {
    const raw = resolveConfig({ mode: "round_robin" });
    expect(raw.mode).toBe("round_robin");
    const engine = toEngineConfig(raw);
    expect(engine.mode).toBe("push");
    expect(engine.push.strategies).toEqual(["rotation"]);
    // Other modes are untouched.
    expect(toEngineConfig(resolveConfig({ mode: "hybrid" })).mode).toBe("hybrid");
  });

  const cand = (id: string) => ({ agent: agent(id), load: 0, proficiency: 3 });
  const ctx = (lastAssigned: string | null) => ({ now: T0, random: () => 0.5, lastAssigned });

  it("the strategy picks the next agent after the previous one, wrapping around", () => {
    const pool = [cand("a"), cand("b"), cand("c")];
    expect(pickAgent(pool, ["rotation"], ctx(null))?.id).toBe("a");
    expect(pickAgent(pool, ["rotation"], ctx("a"))?.id).toBe("b");
    expect(pickAgent(pool, ["rotation"], ctx("b"))?.id).toBe("c");
    expect(pickAgent(pool, ["rotation"], ctx("c"))?.id).toBe("a");
  });

  it("skips agents who are not candidates and continues the turn", () => {
    expect(pickAgent([cand("a"), cand("c")], ["rotation"], ctx("a"))?.id).toBe("c");
    expect(pickAgent([cand("a"), cand("b")], ["rotation"], ctx("b"))?.id).toBe("a");
    // The previous agent left the pool entirely: the next id after it still gets the turn.
    expect(pickAgent([cand("a"), cand("c")], ["rotation"], ctx("b"))?.id).toBe("c");
  });

  it("dispatch hands consecutive tickets to consecutive agents", () => {
    const s = snapshot({
      config: { mode: "round_robin" },
      agents: [agent("a", { maxConcurrent: 3 }), agent("b", { maxConcurrent: 3 }), agent("c", { maxConcurrent: 3 })],
      tickets: Array.from({ length: 7 }, (_, i) => ticket({ id: `t${i}`, queuedAt: T0 + i * 1000 })),
      lastAssignedAgentByQueue: new Map(),
    });
    const order = dispatch(s).map((d) => d.agentId);
    expect(order).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
    expect(s.lastAssignedAgentByQueue!.get("qA")).toBe("a");
  });

  it("continues from where the last ticket went, even after a restart", () => {
    const s = snapshot({
      config: { mode: "round_robin" },
      agents: [agent("a", { maxConcurrent: 3 }), agent("b", { maxConcurrent: 3 }), agent("c", { maxConcurrent: 3 })],
      tickets: [ticket({ id: "t0" }), ticket({ id: "t1", queuedAt: T0 + 1000 })],
      lastAssignedAgentByQueue: new Map([["qA", "b"]]),
    });
    expect(dispatch(s).map((d) => d.agentId)).toEqual(["c", "a"]);
  });

  it("an offline agent is skipped and the rotation carries on", () => {
    const s = snapshot({
      config: { mode: "round_robin" },
      agents: [
        agent("a", { maxConcurrent: 3 }),
        agent("b", { status: "OFFLINE", maxConcurrent: 3 }),
        agent("c", { maxConcurrent: 3 }),
      ],
      tickets: [ticket({ id: "t0" }), ticket({ id: "t1", queuedAt: T0 + 1000 }), ticket({ id: "t2", queuedAt: T0 + 2000 })],
      lastAssignedAgentByQueue: new Map(),
    });
    expect(dispatch(s).map((d) => d.agentId)).toEqual(["a", "c", "a"]);
  });

  it("spreads a simulated day evenly across agents", () => {
    const skills = { general: { proficiency: 3, isPrimary: true } };
    const result = simulate({
      config: { mode: "round_robin" },
      reasons: [{ id: "general", slaMinutes: 15, expectedMinutes: 6 }],
      priorities: { normal: { weight: 0, isLane: false } },
      agents: ["a", "b", "c"].map((id) => ({ id, maxConcurrent: 1, weight: 1, skills })),
      arrivals: Array.from({ length: 60 }, (_, i) => ({ at: 480 + i * 4, reasonId: "general", priorityKey: null })),
      seed: 7,
    });
    const counts = result.perAgent.map((x) => x.served);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(60);
    // Busy agents are skipped (that is the point of a rotation), so shares are close but not identical.
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(14);
    expect(result.fairness).toBeGreaterThan(0.95);
  });
});
