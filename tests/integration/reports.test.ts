import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { alerts, branches, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { acknowledgeAlert, findAnomalies, listAlerts, raiseAlerts } from "@/server/reports/alerts";
import { liveView } from "@/server/reports/live";
import { buildForecast, buildReport } from "@/server/reports/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("reports, live view and alerts (database)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};
  const filters = { from: "2026-09-29", to: "2026-09-29" };

  const issue = (code: string) =>
    issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      // The complaint reason asks for a phone number.
      fields: code === "complaint" ? { phone: "0555000222" } : {},
      consent: code === "complaint",
      source: "reception",
    });

  /** A visitor who waits `wait` minutes and is served for `svc` minutes by Khalid. */
  async function serve(code: string, wait: number, svc: number) {
    const t = await issue(code);
    advanceClock(wait);
    const called = await callNext(khalid, {});
    expect(called.ticket?.id).toBe(t.ticket.id);
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    advanceClock(svc);
    await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "done" } as never);
    advanceClock(1);
    return t.ticket.id;
  }

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "09:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
    await setAgentStatus(khalid, { status: "AVAILABLE" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("computes waiting time, service time, volumes and agent workload from real tickets", async () => {
    await serve("general", 2, 10);
    await serve("general", 6, 20);
    await serve("complaint", 4, 30);
    const noShow = await issue("general");
    advanceClock(3);
    await callNext(khalid, {});
    await ticketAction(khalid, noShow.ticket.id, { action: "no_show" });
    advanceClock(2);

    const { data, timezone } = await buildReport(admin, filters);
    expect(timezone).toBe("Asia/Damascus");
    expect(data.summary).toMatchObject({ visitors: 4, served: 3, noShow: 1, cancelled: 0, stillOpen: 0 });
    expect(data.summary.wait.avg).toBe(3.8); // 2, 6, 4, 3
    expect(data.summary.wait.max).toBe(6);
    expect(data.summary.service.avg).toBe(20); // 10, 20, 30
    expect(data.summary.abandonmentPct).toBe(25);
    expect(data.byReason.find((r) => r.reasonId === reason.general)).toMatchObject({ visitors: 3, served: 2 });
    expect(data.byHour[9].visitors).toBeGreaterThanOrEqual(3);
    const agent = data.agents.find((a) => a.served === 3);
    expect(agent).toBeTruthy();
    expect(agent!.noShow).toBe(1);
    expect(agent!.servingMin).toBeGreaterThanOrEqual(60);
    expect(agent!.loginMin).toBeGreaterThan(0);
    expect(data.heatmap.max).toBeGreaterThanOrEqual(3);

    // Filters narrow the data: one reason, or the agent.
    const onlyComplaints = await buildReport(admin, { ...filters, reasonId: reason.complaint });
    expect(onlyComplaints.data.summary.visitors).toBe(1);
    const wrongHours = await buildReport(admin, { ...filters, hourFrom: 15, hourTo: 20 });
    expect(wrongHours.data.summary.visitors).toBe(0);
    const wrongDay = await buildReport(admin, { ...filters, weekdays: [0] });
    expect(wrongDay.data.summary.visitors).toBe(0);
  });

  it("marks returning visitors and counts recalls", async () => {
    const first = await issueTicket(reception, {
      branchId,
      reasonId: reason.complaint,
      language: "ar",
      fields: { phone: "0555000111" },
      consent: true,
      source: "reception",
    });
    advanceClock(1);
    await callNext(khalid, {});
    await ticketAction(khalid, first.ticket.id, { action: "recall" });
    await ticketAction(khalid, first.ticket.id, { action: "start" });
    await ticketAction(khalid, first.ticket.id, { action: "complete", outcome: "done" } as never);
    advanceClock(5);
    const again = await issueTicket(reception, {
      branchId,
      reasonId: reason.complaint,
      language: "ar",
      fields: { phone: "0555000111" },
      consent: true,
      source: "reception",
    });
    expect(again.ticket.id).not.toBe(first.ticket.id);
    const { data } = await buildReport(admin, filters);
    expect(data.summary.returningPct).toBe(50);
    expect(data.summary.recallRatePct).toBe(100);
  });

  it("limits the range, and only people with reports.view see reports", async () => {
    await expectCode(buildReport(admin, { from: "2026-01-01", to: "2026-09-29" }), "validation");
    await expectCode(buildReport(reception, filters), "forbidden");
    await expectCode(buildReport(khalid, filters), "forbidden");
    expect((await buildReport(supervisor, filters)).data.summary.visitors).toBe(0);
    await expectCode(liveView(reception), "forbidden");
    await expectCode(listAlerts(khalid), "forbidden");
  });

  it("forecasts from history", async () => {
    await serve("general", 1, 5);
    setClock(zonedToUtc("2026-09-30", "09:00", "Asia/Damascus"));
    const f = await buildForecast(admin);
    expect(f.days).toHaveLength(7);
    expect(f.tomorrow.hours).toHaveLength(24);
    expect(f.avgServiceMin).toBe(5);
    expect(f.basedOnDays).toBeGreaterThan(0);
  });

  it("live view shows tiles, desks and long waits without personal data", async () => {
    await issue("general");
    advanceClock(25);
    const live = await liveView(supervisor);
    expect(live.tiles.waiting).toBe(1);
    expect(live.tiles.longestWaitMin).toBe(25);
    expect(live.longWaits).toHaveLength(1);
    expect(live.desks.length).toBeGreaterThan(0);
    expect(JSON.stringify(live)).not.toMatch(/phone|intake|publicToken/);
    const called = await callNext(khalid, {});
    const after = await liveView(supervisor);
    expect(after.tiles.called + after.tiles.serving).toBe(1);
    expect(after.desks.some((d) => d.ticket?.displayNumber === called.ticket?.displayNumber)).toBe(true);
  });

  it("raises each anomaly once, lets a supervisor acknowledge it, and respects thresholds", async () => {
    await updateSetting(admin, "alerts", {
      longWaitMinutes: 10,
      queueLimit: 2,
      agentIdleMinutes: 5,
      noShowCount: 2,
      noShowWindowMinutes: 60,
    });
    await setAgentStatus(khalid, { status: "OFFLINE" });
    await issue("general");
    advanceClock(0.1);
    await issue("general");
    expect(await findAnomalies(branchId)).toEqual([expect.objectContaining({ type: "queue_over_limit" })]);
    advanceClock(15);
    const types = (await findAnomalies(branchId)).map((a) => a.type).sort();
    expect(types).toEqual(["long_wait", "long_wait", "queue_over_limit"]);

    expect(await raiseAlerts(branchId)).toBe(3);
    expect(await raiseAlerts(branchId)).toBe(0); // deduplicated
    const open = await listAlerts(supervisor, { openOnly: true });
    expect(open).toHaveLength(3);
    const live = await liveView(supervisor);
    expect(live.alerts).toHaveLength(3);

    await acknowledgeAlert(supervisor, open[0].id);
    expect(await listAlerts(supervisor, { openOnly: true })).toHaveLength(2);
    // Acknowledging does not re-open the same condition within the hour.
    expect(await raiseAlerts(branchId)).toBe(0);
    await expectCode(acknowledgeAlert(reception, open[1].id), "forbidden");

    // Alerts can be switched off.
    await db().delete(alerts).where(eq(alerts.branchId, branchId));
    await updateSetting(admin, "alerts", { enabled: false });
    expect(await findAnomalies(branchId)).toEqual([]);
  });

  it("flags an idle available agent while people wait, and a no-show spike", async () => {
    await updateSetting(admin, "alerts", {
      agentIdleMinutes: 5,
      noShowCount: 2,
      noShowWindowMinutes: 60,
      longWaitMinutes: 240,
      queueLimit: 100,
    });
    // Nobody can be assigned: the only agent is idle but the visitor's reason is served by others; keep him available.
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    const a = await issue("general");
    advanceClock(0.1); // tickets issued in the same millisecond have no defined order
    const b = await issue("general");
    advanceClock(1);
    for (const t of [a, b]) {
      await callNext(khalid, {});
      await ticketAction(khalid, t.ticket.id, { action: "no_show" });
    }
    const spike = (await findAnomalies(branchId)).find((x) => x.type === "no_show_spike");
    expect(spike?.payload).toMatchObject({ count: 2 });
  });
});
