import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "@/domain/distribution/config";
import {
  canServe,
  dispatch,
  expiredReservations,
  overflowActive,
  selectAgentForTicket,
  selectTicketForAgent,
} from "@/domain/distribution/engine";
import { estimateWaitMinutes } from "@/domain/distribution/estimate";
import { orderTickets } from "@/domain/distribution/ordering";
import { pickAgent } from "@/domain/distribution/strategies";
import { agent, min, snapshot, T0, ticket } from "./engine-helpers";

const FIFO = { ordering: { priorityWeight: 0, slaWeight: 0, aging: [], maxWaitMinutes: 0, appointmentBoost: 0 } };

describe("config resolution", () => {
  it("merges global → branch → queue with defaults and replaces arrays", () => {
    const cfg = resolveConfig(
      { mode: "push", push: { strategies: ["proficiency"] } },
      { hybrid: { acceptTimeoutMinutes: 5 } },
      { push: { strategies: ["random"] } },
    );
    expect(cfg.mode).toBe("push");
    expect(cfg.push.strategies).toEqual(["random"]);
    expect(cfg.hybrid.acceptTimeoutMinutes).toBe(5);
    expect(cfg.noShow.maxRecalls).toBe(DEFAULT_CONFIG.noShow.maxRecalls);
  });

  it("ignores an invalid layer instead of breaking the queue", () => {
    expect(resolveConfig({ mode: "hybrid" }, { mode: "nonsense" }).mode).toBe("hybrid");
  });
});

describe("queue ordering", () => {
  const order = (s: ReturnType<typeof snapshot>) =>
    orderTickets(s.tickets, s.now, s.configFor, s.reasons, s.priorities).map((t) => t.id);

  it("is FIFO when only waiting time counts", () => {
    const s = snapshot({
      config: FIFO,
      tickets: [
        ticket({ id: "b", queuedAt: T0 - min(5) }),
        ticket({ id: "a", queuedAt: T0 - min(9) }),
        ticket({ id: "c", queuedAt: T0 - min(1) }),
      ],
    });
    expect(order(s)).toEqual(["a", "b", "c"]);
  });

  it("puts priority lanes first and lets priority weight move tickets ahead", () => {
    const s = snapshot({
      tickets: [
        ticket({ id: "old", queuedAt: T0 - min(10) }),
        ticket({ id: "elderly", queuedAt: T0 - min(2), priorityKey: "elderly" }),
        ticket({ id: "vip", queuedAt: T0, priorityKey: "vip" }),
      ],
    });
    expect(order(s)).toEqual(["vip", "elderly", "old"]);
  });

  it("aging and SLA pressure eventually beat priority, so nobody starves", () => {
    const s = snapshot({
      tickets: [
        ticket({ id: "elderly", queuedAt: T0 - min(1), priorityKey: "elderly" }),
        ticket({ id: "long", queuedAt: T0 - min(30) }),
      ],
    });
    expect(order(s)).toEqual(["long", "elderly"]);
  });

  it("max-wait guarantee overrides even priority lanes", () => {
    const s = snapshot({
      config: { ordering: { maxWaitMinutes: 25 } },
      tickets: [
        ticket({ id: "vip", priorityKey: "vip" }),
        ticket({ id: "starved", queuedAt: T0 - min(26) }),
        ticket({ id: "older-starved", queuedAt: T0 - min(40) }),
      ],
    });
    expect(order(s)).toEqual(["older-starved", "starved", "vip"]);
  });

  it("boosts appointments shortly before their slot", () => {
    const s = snapshot({
      tickets: [
        ticket({ id: "walkin", queuedAt: T0 - min(8) }),
        ticket({ id: "appt", queuedAt: T0, appointmentAt: T0 + min(5) }),
      ],
    });
    expect(order(s)).toEqual(["appt", "walkin"]);
  });
});

describe("assignment strategies", () => {
  const ctx = { now: T0, random: () => 0.5 };
  const cand = (id: string, load: number, proficiency = 3, extra = {}) => ({ agent: agent(id, extra), load, proficiency });

  it("least waiting", () => {
    expect(pickAgent([cand("a", 2), cand("b", 0), cand("c", 1)], ["least_waiting"], ctx)?.id).toBe("b");
  });
  it("round robin picks the least recently assigned", () => {
    expect(
      pickAgent(
        [cand("a", 0, 3, { lastAssignedAt: T0 - min(1) }), cand("b", 0, 3, { lastAssignedAt: T0 - min(9) })],
        ["round_robin"],
        ctx,
      )?.id,
    ).toBe("b");
  });
  it("longest idle prefers idle agents idle the longest", () => {
    expect(
      pickAgent(
        [
          cand("a", 0, 3, { idleSince: T0 - min(2) }),
          cand("b", 1, 3, { idleSince: T0 - min(60) }),
          cand("c", 0, 3, { idleSince: T0 - min(20) }),
        ],
        ["longest_idle"],
        ctx,
      )?.id,
    ).toBe("c");
  });
  it("highest proficiency, then chain breaks ties", () => {
    expect(pickAgent([cand("a", 1, 5), cand("b", 0, 5), cand("c", 0, 2)], ["proficiency", "least_waiting"], ctx)?.id).toBe("b");
  });
  it("weighted fairness respects weights", () => {
    expect(
      pickAgent(
        [cand("a", 0, 3, { handledToday: 4, weight: 2 }), cand("b", 0, 3, { handledToday: 3, weight: 1 })],
        ["weighted"],
        ctx,
      )?.id,
    ).toBe("a");
  });
  it("random is deterministic with a seeded source", () => {
    const pick = (r: number) =>
      pickAgent([cand("a", 0), cand("b", 0)], ["random"], {
        now: T0,
        random: (() => {
          let i = 0;
          return () => [r, 1 - r][i++ % 2];
        })(),
      })?.id;
    expect(pick(0.1)).toBe("a");
    expect(pick(0.9)).toBe("b");
  });
  it("returns null with no candidates", () => {
    expect(pickAgent([], ["round_robin"], ctx)).toBeNull();
  });
});

describe("pull: call next", () => {
  it("gives the agent the head of the queues they serve", () => {
    const s = snapshot({
      agents: [agent("k", { reasons: { rA: [3, true] } })],
      tickets: [
        ticket({ id: "b1", reasonId: "rB", queueId: "qB", queuedAt: T0 - min(30) }),
        ticket({ id: "a2", queuedAt: T0 - min(2) }),
        ticket({ id: "a1", queuedAt: T0 - min(5) }),
      ],
    });
    expect(selectTicketForAgent(s, "k")).toMatchObject({ ticket: { id: "a1" }, reserved: false });
  });

  it("serves reserved tickets first, never takes another agent's reservation", () => {
    const s = snapshot({
      agents: [agent("k"), agent("n")],
      tickets: [
        ticket({ id: "forN", assignedAgentId: "n", queuedAt: T0 - min(20) }),
        ticket({ id: "pool", queuedAt: T0 - min(10) }),
        ticket({ id: "forK", assignedAgentId: "k" }),
      ],
    });
    expect(selectTicketForAgent(s, "k")).toMatchObject({ ticket: { id: "forK" }, reserved: true });
  });

  it("respects status and capacity", () => {
    const busy = snapshot({
      agents: [agent("k")],
      tickets: [ticket({ status: "SERVING", servingAgentId: "k" }), ticket({ id: "next" })],
    });
    expect(selectTicketForAgent(busy, "k")).toMatchObject({ ticket: null, reason: "at_capacity" });
    const onBreak = snapshot({ agents: [agent("k", { status: "ON_BREAK" })], tickets: [ticket()] });
    expect(selectTicketForAgent(onBreak, "k")).toMatchObject({ ticket: null, reason: "not_working" });
    const two = snapshot({
      agents: [agent("k", { maxConcurrent: 2 })],
      tickets: [ticket({ status: "SERVING", servingAgentId: "k" }), ticket({ id: "next" })],
    });
    expect(selectTicketForAgent(two, "k")).toMatchObject({ ticket: { id: "next" } });
  });

  it("manual mode never hands out unassigned tickets", () => {
    const s = snapshot({
      config: { mode: "manual" },
      agents: [agent("k")],
      tickets: [ticket({ id: "pool" }), ticket({ id: "mine", assignedAgentId: "k" })],
    });
    expect(selectTicketForAgent(s, "k")).toMatchObject({ ticket: { id: "mine" } });
    const s2 = snapshot({ config: { mode: "manual" }, agents: [agent("k")], tickets: [ticket({ id: "pool" })] });
    expect(selectTicketForAgent(s2, "k")).toMatchObject({ ticket: null, reason: "empty" });
  });
});

describe("backups and overflow", () => {
  const backup = agent("b", { reasons: { rA: [2, false] } });

  it("backups wait while a primary is free", () => {
    const s = snapshot({ agents: [agent("p"), backup], tickets: [ticket()] });
    expect(canServe(s, backup, s.tickets[0])).toBe(false);
    expect(selectTicketForAgent(s, "b")).toMatchObject({ ticket: null, reason: "empty" });
  });

  it("backups help when no primary is free", () => {
    const s = snapshot({ agents: [agent("p", { status: "ON_BREAK" }), backup], tickets: [ticket({ id: "x" })] });
    expect(selectTicketForAgent(s, "b")).toMatchObject({ ticket: { id: "x" } });
  });

  it("overflow (queue too long or wait too long) lets backups serve", () => {
    const long = snapshot({
      config: { overflow: { maxQueueLength: 2 } },
      agents: [agent("p"), backup],
      tickets: [ticket(), ticket(), ticket()],
    });
    expect(overflowActive(long, "qA")).toBe(true);
    expect(canServe(long, backup, long.tickets[0])).toBe(true);
    const old = snapshot({
      config: { overflow: { maxWaitMinutes: 10 } },
      agents: [agent("p"), backup],
      tickets: [ticket({ queuedAt: T0 - min(11) })],
    });
    expect(overflowActive(old, "qA")).toBe(true);
  });
});

describe("push, hybrid and sticky", () => {
  it("push reserves the least loaded primary and spreads a burst evenly", () => {
    const s = snapshot({
      config: { mode: "push", push: { strategies: ["least_waiting", "round_robin"] }, capacity: { countAssignedWaiting: true } },
      agents: [agent("a", { maxConcurrent: 3 }), agent("b", { maxConcurrent: 3 }), agent("c", { maxConcurrent: 3 })],
      tickets: [ticket(), ticket(), ticket(), ticket(), ticket(), ticket()],
    });
    const out = dispatch(s);
    const per = Object.groupBy(out, (a) => a.agentId);
    expect(Object.values(per).map((x) => x!.length)).toEqual([2, 2, 2]);
  });

  it("push prefers proficiency when configured", () => {
    const s = snapshot({
      config: { mode: "push", push: { strategies: ["proficiency"] } },
      agents: [agent("junior", { reasons: { rA: [2, true] } }), agent("expert", { reasons: { rA: [5, true] } })],
      tickets: [ticket({ id: "x" })],
    });
    expect(selectAgentForTicket(s, s.tickets[0])).toEqual({ agentId: "expert", via: "push" });
  });

  it("pull mode does not reserve", () => {
    const s = snapshot({ agents: [agent("a")], tickets: [ticket()] });
    expect(dispatch(s)).toEqual([]);
  });

  it("push leaves tickets in the pool when nobody is free", () => {
    const s = snapshot({ config: { mode: "push" }, agents: [agent("a", { status: "OFFLINE" })], tickets: [ticket()] });
    expect(dispatch(s)).toEqual([]);
  });

  it("sticky returning visitor goes to the previous agent even in pull mode", () => {
    const s = snapshot({
      config: { sticky: { enabled: true } },
      agents: [agent("a"), agent("b")],
      tickets: [ticket({ lastAgentId: "b" })],
    });
    expect(dispatch(s)).toEqual([{ ticketId: s.tickets[0].id, agentId: "b", via: "sticky" }]);
  });

  it("hybrid releases reservations after the accept timeout, and any mode releases when the agent leaves", () => {
    const s = snapshot({
      config: { mode: "hybrid", hybrid: { acceptTimeoutMinutes: 3 } },
      agents: [agent("a"), agent("gone", { status: "ON_BREAK" })],
      tickets: [
        ticket({ id: "fresh", assignedAgentId: "a", assignedAt: T0 - min(1) }),
        ticket({ id: "stale", assignedAgentId: "a", assignedAt: T0 - min(4) }),
        ticket({ id: "orphan", assignedAgentId: "gone", assignedAt: T0 }),
      ],
    });
    expect(expiredReservations(s).map((r) => [r.ticketId, r.cause])).toEqual([
      ["stale", "accept_timeout"],
      ["orphan", "agent_unavailable"],
    ]);
  });

  it("pure push reservations do not time out", () => {
    const s = snapshot({
      config: { mode: "push" },
      agents: [agent("a")],
      tickets: [ticket({ assignedAgentId: "a", assignedAt: T0 - min(60) })],
    });
    expect(expiredReservations(s)).toEqual([]);
  });
});

describe("wait estimate", () => {
  it("scales with people ahead and agents", () => {
    expect(estimateWaitMinutes(0, 2, 10)).toBe(0);
    expect(estimateWaitMinutes(4, 2, 10)).toBe(20);
    expect(estimateWaitMinutes(3, 0, 5)).toBe(15);
  });
});

describe("agent status semantics", () => {
  it("BUSY agents keep reservations but receive no new work", () => {
    const s = snapshot({
      config: { mode: "hybrid" },
      agents: [agent("busy", { status: "BUSY" }), agent("free")],
      tickets: [ticket({ id: "kept", assignedAgentId: "busy", assignedAt: T0 }), ticket({ id: "new" })],
    });
    expect(expiredReservations(s)).toEqual([]);
    expect(dispatch(s)).toEqual([{ ticketId: "new", agentId: "free", via: "push" }]);
  });
});
