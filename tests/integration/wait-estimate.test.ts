import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, queues, tickets, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { clearSettingOverride, updateSetting } from "@/server/admin/settings-admin";
import { waitAnalytics } from "@/server/admin/wait-analytics";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { issueTicket } from "@/server/queue/tickets";
import { publicTicketStatus, receptionContext } from "@/server/queue/views";
import { clearWaitAnalyticsCache } from "@/server/queue/wait-analytics";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const NOW = zonedToUtc("2026-09-29", "10:00", "Asia/Damascus");

describe.runIf(available)("waiting-time estimate (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let supervisor: Actor;
  let branchId: string;
  let orgId: string;
  let reasonId: string;
  let expected: number;
  let seeded = 0;

  /** Each ticket arrives a little later so their order (and so the people ahead) is fixed. */
  const issue = (extra: Record<string, unknown> = {}) => {
    advanceClock(0.1);
    return issueTicket(reception, {
      branchId,
      reasonId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
      ...extra,
    });
  };
  /** Issues several tickets; the last one has people ahead. */
  async function lastOfSeveral() {
    for (let i = 0; i < 4; i++) await issue();
    const r = await issue();
    expect(r.ahead).toBeGreaterThan(0);
    return r;
  }
  async function seedServices(minutes: number, count: number) {
    const [queue] = await db().select().from(queues).where(eq(queues.branchId, branchId));
    const [reasonRow] = await db().select().from(visitReasons).where(eq(visitReasons.id, reasonId));
    const offset = seeded;
    seeded += count;
    const rows = Array.from({ length: count }, (_, i0) => {
      const i = offset + i0;
      const started = new Date(NOW - (2 + i) * 3_600_000);
      return {
        organizationId: orgId,
        branchId,
        queueId: queue.id,
        reasonId,
        prefix: "Z",
        number: i + 1,
        displayNumber: `Z-${i + 1}`,
        serviceDay: "2026-09-28",
        status: "COMPLETED" as const,
        publicToken: `seed-${reasonRow.code}-${minutes}-${i}-${Math.random()}`,
        arrivedAt: started,
        queuedAt: started,
        startedAt: started,
        finishedAt: new Date(started.getTime() + minutes * 60_000),
      };
    });
    await db().insert(tickets).values(rows);
  }

  beforeEach(async () => {
    setClock(NOW);
    seeded = 0;
    clearWaitAnalyticsCache();
    orgId = await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    const [r] = await db().select().from(visitReasons).where(eq(visitReasons.code, "general"));
    reasonId = r.id;
    expected = r.expectedServiceMinutes;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("uses the reason's expected time by default and a fixed time when configured", async () => {
    let r = await lastOfSeveral();
    expect(r.estimatedWaitMinutes).toBeGreaterThan(0); // default = per reason, divided by the agents serving

    await updateSetting(admin, "waitEstimate", { mode: "reason", divideByAgents: false });
    r = await issue();
    expect(r.estimatedWaitMinutes).toBe(r.ahead * expected);

    await updateSetting(admin, "waitEstimate", { mode: "fixed", fixedMinutesPerVisitor: 7, divideByAgents: false });
    r = await issue();
    expect(r.estimatedWaitMinutes).toBe(r.ahead * 7);

    await updateSetting(admin, "waitEstimate", { mode: "fixed", fixedMinutesPerVisitor: 7, divideByAgents: false, rounding: 10 });
    r = await issue();
    expect(r.estimatedWaitMinutes).toBe(Math.ceil((r.ahead * 7) / 10) * 10);
  });

  it("learns from completed services and falls back while there are too few", async () => {
    await updateSetting(admin, "waitEstimate", { mode: "analytics", minSamples: 20, divideByAgents: false });
    await seedServices(3, 5);
    let r = await lastOfSeveral();
    expect(r.estimatedWaitMinutes).toBe(r.ahead * expected); // 5 of 20: still learning

    const stats = await waitAnalytics(admin, branchId);
    const row = stats.reasons.find((x) => x.reasonId === reasonId)!;
    expect(row).toMatchObject({ samples: 5, expectedMinutes: expected, source: "learning" });

    await seedServices(3, 20); // 25 in total
    clearWaitAnalyticsCache();
    r = await issue();
    expect(r.estimatedWaitMinutes).toBe(r.ahead * 3); // the median service took 3 minutes
    const after = (await waitAnalytics(admin, branchId)).reasons.find((x) => x.reasonId === reasonId)!;
    expect(after).toMatchObject({ samples: 25, median: 3, usedMinutes: 3, source: "analytics" });
  });

  it("lets a branch have its own rule, and clears back to the default", async () => {
    await updateSetting(admin, "waitEstimate", { mode: "fixed", fixedMinutesPerVisitor: 4, divideByAgents: false });
    await updateSetting(admin, "waitEstimate", { mode: "fixed", fixedMinutesPerVisitor: 10, divideByAgents: false }, branchId);
    const r = await lastOfSeveral();
    expect(r.estimatedWaitMinutes).toBe(r.ahead * 10);
    await clearSettingOverride(admin, "waitEstimate", branchId);
    const after = await issue();
    expect(after.estimatedWaitMinutes).toBe(after.ahead * 4);
  });

  it("exposes the wording to the ticket and the visitor page, and can hide it", async () => {
    await updateSetting(admin, "waitEstimate", {
      showOnTicket: false,
      showAsRange: true,
      disclaimer: { ar: "تقريبي", en: "Approximate" },
    });
    const ctx = await receptionContext(reception, branchId);
    expect(ctx.waitDisplay).toMatchObject({ showOnTicket: false, showAsRange: true, disclaimer: { en: "Approximate" } });
    const r = await lastOfSeveral();
    const status = await publicTicketStatus(r.ticket.publicToken);
    expect(status?.waitDisplay.showOnTicket).toBe(false);
    expect(status?.position?.waitHigh).toBeGreaterThanOrEqual(status!.position!.waitLow);
  });

  it("checks permissions for the analytics table", async () => {
    await expect(waitAnalytics(reception, branchId)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "forbidden",
    );
    await expect(waitAnalytics(supervisor, branchId)).resolves.toBeDefined();
  });
});
