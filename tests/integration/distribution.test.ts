import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, queues, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { deleteRule, listRules, putRule, runSimulation } from "@/server/admin/distribution";
import { setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { issueTicket, setAgentStatus } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("distribution rules & simulation (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let branchId: string;
  let generalId: string;
  let complaintQueue: string;

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    [{ id: generalId }] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "general"));
    const [c] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "complaint"));
    [{ id: complaintQueue }] = await db()
      .select({ id: queues.id })
      .from(queues)
      .where(and(eq(queues.reasonId, c.id), eq(queues.branchId, branchId)));
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("a queue override applies immediately and only to that queue", async () => {
    await putRule(admin, { scope: "queue", queueId: complaintQueue, config: { mode: "push" } });
    const khalid = await actorFor("khalid@dor.local");
    const noura = await actorFor("noura@dor.local");
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    await setAgentStatus(noura, { status: "AVAILABLE" });
    const general = await issueTicket(reception, {
      branchId,
      reasonId: generalId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    const [complaint] = await db().select().from(visitReasons).where(eq(visitReasons.code, "complaint"));
    const pushed = await issueTicket(reception, {
      branchId,
      reasonId: complaint.id,
      language: "ar",
      fields: { phone: "0501112222" },
      consent: true,
      source: "reception",
    });
    expect(general.ticket.assignedAgentId).toBeNull();
    expect(pushed.ticket.assignedAgentId).toBe(noura.auth.user.id); // primary for complaints

    const listed = await listRules(admin);
    const override = listed.rules.find((r) => r.scope === "queue")!;
    await deleteRule(admin, override.id);
    expect((await listRules(admin)).rules.some((r) => r.scope === "queue")).toBe(false);
  });

  it("rejects invalid rules and protects the global rule", async () => {
    await expect(putRule(admin, { scope: "global", config: { mode: "chaos" } })).rejects.toBeInstanceOf(AppError);
    await expect(putRule(admin, { scope: "global", config: { hybrid: { acceptTimeoutMinutes: -3 } } })).rejects.toBeInstanceOf(
      AppError,
    );
    const global = (await listRules(admin)).rules.find((r) => r.scope === "global")!;
    await expect(deleteRule(admin, global.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.details?.reason === "global_rule",
    );
    await putRule(admin, { scope: "global", config: { mode: "hybrid" } });
    expect((await listRules(admin)).rules.find((r) => r.scope === "global")!.version).toBe(2);
  });

  it("simulates current rules against a candidate on the same synthetic day", async () => {
    const out = await runSimulation(admin, {
      branchId,
      source: { type: "synthetic", total: 150, opensAt: 480, closesAt: 960, vipShare: 0.02, elderlyShare: 0.05 },
      extraAgents: 0,
      scenarios: [
        { label: "Current", useCurrent: true, config: {} },
        {
          label: "Push by proficiency",
          useCurrent: false,
          config: { mode: "push", push: { strategies: ["proficiency", "least_waiting"] } },
        },
      ],
      seed: 3,
      serviceVariability: 0.5,
    });
    expect(out.arrivals).toBe(150);
    expect(out.agents).toHaveLength(5);
    expect(out.results).toHaveLength(2);
    for (const r of out.results) {
      expect(r.totals.tickets).toBe(150);
      expect(r.perAgent).toHaveLength(5);
    }
    const more = await runSimulation(admin, {
      branchId,
      source: { type: "synthetic", total: 150, opensAt: 480, closesAt: 960, vipShare: 0.02, elderlyShare: 0.05 },
      extraAgents: 3,
      scenarios: [{ label: "Current", useCurrent: true, config: {} }],
      seed: 3,
      serviceVariability: 0.5,
    });
    expect(more.results[0].totals.avgWait).toBeLessThanOrEqual(out.results[0].totals.avgWait);
  });

  it("replays a real day from the database", async () => {
    for (let i = 0; i < 5; i++)
      await issueTicket(reception, {
        branchId,
        reasonId: generalId,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      });
    const out = await runSimulation(admin, {
      branchId,
      source: { type: "replay", date: "2026-09-29" },
      extraAgents: 0,
      scenarios: [{ label: "Current", useCurrent: true, config: {} }],
      seed: 1,
      serviceVariability: 0.5,
    });
    expect(out.arrivals).toBe(5);
    expect(out.results[0].totals.served).toBe(5);
  });

  it("only users with the permission can change rules or simulate", async () => {
    await expect(putRule(reception, { scope: "global", config: {} })).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "forbidden",
    );
    await expect(
      runSimulation(reception, {
        branchId,
        source: { type: "synthetic", total: 10, opensAt: 480, closesAt: 960, vipShare: 0, elderlyShare: 0 },
        extraAgents: 0,
        scenarios: [{ label: "x", useCurrent: true, config: {} }],
        seed: 1,
        serviceVariability: 0.5,
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "forbidden");
  });
});
