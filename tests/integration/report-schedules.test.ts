import { desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as exportRoute from "@/app/api/v1/reports/export/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import { db, pool } from "@/db/client";
import { auditLogs, branches, notificationsLog, reportSchedules, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import {
  createReportSchedule,
  deleteReportSchedule,
  listReportSchedules,
  reportScheduleInput,
  sendReportScheduleNow,
  updateReportSchedule,
  type ReportScheduleInput,
} from "@/server/admin/report-schedules";
import { setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { mockOutbox } from "@/server/messaging/providers";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { isDue, lastSlot, periodFor, runDueSchedules } from "@/server/reports/scheduler";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const TZ = "Asia/Riyadh";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("report schedules and exports (database)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  let generalId: string;

  const input = (over: Partial<ReportScheduleInput> = {}): ReportScheduleInput =>
    reportScheduleInput.parse({
      name: "Daily summary",
      frequency: "daily",
      sendHour: 7,
      format: "csv",
      locale: "en",
      recipients: ["Manager@Example.com", "ops@example.com"],
      ...over,
    });

  async function serveOne() {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: generalId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    await callNext(khalid, {});
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    setClock(at("2026-09-28", "10:20"));
    await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "done" } as never);
  }

  beforeEach(async () => {
    process.env.MESSAGING_MOCK = "true";
    mockOutbox().length = 0;
    setClock(at("2026-09-28", "10:00"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    [{ id: generalId }] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "general"));
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    await serveOne();
    setClock(at("2026-09-29", "06:00"));
  });
  afterEach(() => {
    setClock(null);
    delete process.env.MESSAGING_MOCK;
  });
  afterAll(async () => {
    await pool().end();
  });

  it("creates, lists, updates and deletes schedules, with an audit trail", async () => {
    const created = await createReportSchedule(admin, input());
    expect(created.recipients).toEqual(["manager@example.com", "ops@example.com"]);
    expect(created).toMatchObject({ frequency: "daily", weekday: null, sendHour: 7, branchId: null, lastRunAt: null });

    const weekly = await createReportSchedule(
      admin,
      input({ name: "Weekly", frequency: "weekly", weekday: 4, branchId, reasonId: generalId }),
    );
    expect(weekly).toMatchObject({ weekday: 4, branchId, reasonId: generalId });
    expect((await listReportSchedules(admin)).map((s) => s.name)).toEqual(["Daily summary", "Weekly"]);

    const updated = await updateReportSchedule(admin, created.id, input({ name: "Renamed", isActive: false }));
    expect(updated).toMatchObject({ name: "Renamed", isActive: false });
    await deleteReportSchedule(admin, weekly.id);
    expect(await listReportSchedules(admin)).toHaveLength(1);

    const actions = (await db().select().from(auditLogs).orderBy(desc(auditLogs.at))).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["report_schedule.created", "report_schedule.updated", "report_schedule.deleted"]),
    );
  });

  it("validates input", async () => {
    const bad = (over: object) => reportScheduleInput.safeParse({ ...input(), ...over }).success;
    expect(bad({ recipients: [] })).toBe(false);
    expect(bad({ recipients: ["not-an-email"] })).toBe(false);
    expect(bad({ recipients: Array.from({ length: 21 }, (_, i) => `u${i}@example.com`) })).toBe(false);
    expect(bad({ recipients: Array.from({ length: 20 }, (_, i) => `u${i}@example.com`) })).toBe(true);
    expect(bad({ frequency: "weekly", weekday: undefined })).toBe(false);
    expect(bad({ sendHour: 24 })).toBe(false);
    expect(bad({ format: "docx" })).toBe(false);
    await expectCode(createReportSchedule(admin, input({ branchId: "00000000-0000-4000-8000-000000000000" })), "validation");
    await expectCode(createReportSchedule(admin, input({ reasonId: "00000000-0000-4000-8000-000000000000" })), "validation");
  });

  it("needs the reports.schedule permission", async () => {
    // The supervisor may view and export reports but not schedule them.
    await expectCode(listReportSchedules(supervisor), "forbidden");
    await expectCode(createReportSchedule(supervisor, input()), "forbidden");
    await expectCode(listReportSchedules(reception), "forbidden");
    const s = await createReportSchedule(admin, input());
    await expectCode(deleteReportSchedule(supervisor, s.id), "forbidden");
    await expectCode(sendReportScheduleNow(supervisor, s.id), "forbidden");
  });

  it("works out the period and the last slot in the branch time zone", () => {
    const now = at("2026-09-29", "07:05"); // a Tuesday
    expect(periodFor("daily", now, TZ)).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(periodFor("weekly", now, TZ)).toEqual({ from: "2026-09-22", to: "2026-09-28" });
    expect(lastSlot({ frequency: "daily", weekday: null, sendHour: 7 }, now, TZ)).toBe(at("2026-09-29", "07:00"));
    expect(lastSlot({ frequency: "daily", weekday: null, sendHour: 7 }, at("2026-09-29", "06:59"), TZ)).toBe(
      at("2026-09-28", "07:00"),
    );
    expect(lastSlot({ frequency: "weekly", weekday: 2, sendHour: 8 }, at("2026-09-29", "07:59"), TZ)).toBe(
      at("2026-09-22", "08:00"),
    );
    expect(lastSlot({ frequency: "weekly", weekday: 2, sendHour: 8 }, at("2026-09-29", "08:00"), TZ)).toBe(
      at("2026-09-29", "08:00"),
    );
    expect(lastSlot({ frequency: "weekly", weekday: 0, sendHour: 8 }, at("2026-09-29", "12:00"), TZ)).toBe(
      at("2026-09-27", "08:00"),
    );
  });

  it("emails a daily report with the file attached, once per period", async () => {
    const s = await createReportSchedule(admin, input());
    const row = () =>
      db()
        .select()
        .from(reportSchedules)
        .where(eq(reportSchedules.id, s.id))
        .then((r) => r[0]);

    // Before the send hour: nothing. A schedule created after the slot does not fire for that slot either.
    expect(await runDueSchedules(at("2026-09-29", "06:30"))).toEqual([]);
    expect(isDue(await row(), at("2026-09-29", "06:30"), TZ).due).toBe(false);

    setClock(at("2026-09-29", "07:05"));
    expect(await runDueSchedules()).toEqual([s.id]);
    const sent = mockOutbox();
    expect(sent.map((m) => m.to).sort()).toEqual(["manager@example.com", "ops@example.com"]);
    const mail = sent[0];
    expect(mail.subject).toBe("Scheduled report: Daily summary (2026-09-28)");
    expect(mail.text).toContain("Daily summary");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0].filename).toBe("dor-report-2026-09-28_2026-09-28.csv");
    const csv = mail.attachments![0].content.toString("utf8");
    expect(csv).toContain("Visitors,1");
    expect(csv).toContain("Served,1");
    expect((await row()).lastRunAt).not.toBeNull();
    expect((await row()).lastError).toBeNull();

    // Same period again: not sent twice, even after a restart of the scheduler.
    expect(await runDueSchedules(at("2026-09-29", "07:10"))).toEqual([]);
    expect(await runDueSchedules(at("2026-09-29", "23:59"))).toEqual([]);
    expect(mockOutbox()).toHaveLength(2);

    // The next day it runs again, for the new "yesterday".
    expect(await runDueSchedules(at("2026-09-30", "07:01"))).toEqual([s.id]);
    expect(mockOutbox()).toHaveLength(4);
    expect(mockOutbox()[2].attachments![0].filename).toBe("dor-report-2026-09-29_2026-09-29.csv");

    // The delivery is logged with masked recipients.
    const log = await db().select().from(notificationsLog).where(eq(notificationsLog.event, "report_scheduled"));
    expect(log).toHaveLength(4);
    expect(log.every((l) => l.status === "sent" && l.recipientMasked?.includes("****"))).toBe(true);
    expect(log.map((l) => l.recipientMasked)).not.toContain("manager@example.com");
  });

  it("catches up once after downtime and skips inactive schedules", async () => {
    const a = await createReportSchedule(admin, input());
    const b = await createReportSchedule(admin, input({ name: "Off", isActive: false }));
    void b;
    // The server was down over the send hour; the next pass in the afternoon sends it once.
    expect(await runDueSchedules(at("2026-09-29", "15:00"))).toEqual([a.id]);
    expect(mockOutbox()).toHaveLength(2);
  });

  it("sends weekly reports on their weekday for the previous seven days, in Arabic PDF", async () => {
    const s = await createReportSchedule(
      admin,
      input({ name: "أسبوعي", frequency: "weekly", weekday: 2, sendHour: 8, format: "pdf", locale: "ar" }),
    );
    // Created on a Tuesday at 06:00, so this Tuesday 08:00 counts...
    expect(await runDueSchedules(at("2026-09-29", "08:05"))).toEqual([s.id]);
    const mail = mockOutbox()[0];
    expect(mail.subject).toContain("التقرير المجدول: أسبوعي");
    expect(mail.attachments![0].filename).toBe("dor-report-2026-09-22_2026-09-28.pdf");
    expect(mail.attachments![0].contentType).toBe("application/pdf");
    expect(mail.attachments![0].content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // ...and not again until next Tuesday.
    expect(await runDueSchedules(at("2026-10-05", "12:00"))).toEqual([]);
    expect(await runDueSchedules(at("2026-10-06", "08:01"))).toEqual([s.id]);
    expect(mockOutbox().at(-1)!.attachments![0].filename).toBe("dor-report-2026-09-29_2026-10-05.pdf");
  });

  it("sends now without touching the last run", async () => {
    const s = await createReportSchedule(admin, input({ format: "xlsx" }));
    const result = await sendReportScheduleNow(admin, s.id);
    expect(result).toMatchObject({ sent: 2, failed: 0, skipped: 0 });
    expect(result.period).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(mockOutbox()).toHaveLength(2);
    expect(mockOutbox()[0].attachments![0].filename).toMatch(/\.xlsx$/);
    const [row] = await db().select().from(reportSchedules).where(eq(reportSchedules.id, s.id));
    expect(row.lastRunAt).toBeNull();
    const [entry] = await db().select().from(auditLogs).where(eq(auditLogs.action, "report_schedule.sent_now"));
    expect(entry.entityId).toBe(s.id);
    // The regular run is unaffected.
    expect(await runDueSchedules(at("2026-09-29", "07:05"))).toEqual([s.id]);
  });

  it("reports a missing email channel instead of failing the run", async () => {
    delete process.env.MESSAGING_MOCK;
    const s = await createReportSchedule(admin, input());
    expect(await runDueSchedules(at("2026-09-29", "07:05"))).toEqual([s.id]);
    const [row] = await db().select().from(reportSchedules).where(eq(reportSchedules.id, s.id));
    expect(row.lastError).toBe("failed:0 skipped:2");
  });

  it("downloads exports through the API with the right headers and an audit entry", async () => {
    const origin = "http://localhost:3000";
    const headers = { host: "localhost:3000", "x-dor-client-ip": "10.0.0.7", origin, "content-type": "application/json" };
    const login = await loginRoute.POST(
      new NextRequest(new URL("/api/v1/auth/login", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "admin@dor.local", password: "Dor@Demo2026" }),
      }),
      { params: Promise.resolve({}) },
    );
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const get = (qs: string, c = cookie) =>
      exportRoute.GET(
        new NextRequest(new URL(`/api/v1/reports/export?${qs}`, origin), {
          headers: { host: "localhost:3000", "x-dor-client-ip": "10.0.0.7", cookie: c },
        }),
        {
          params: Promise.resolve({}),
        },
      );

    const xlsx = await get("format=xlsx&locale=ar&from=2026-09-28&to=2026-09-28");
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-disposition")).toBe('attachment; filename="dor-report-2026-09-28_2026-09-28.xlsx"');
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(3000);
    const csv = await get("format=csv&locale=en&from=2026-09-28&to=2026-09-28");
    expect((await csv.text()).replace(/^﻿/, "")).toContain("Queue performance report");
    const pdf = await get("format=pdf&locale=ar&from=2026-09-28&to=2026-09-28");
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString("latin1"),
    ).toBe("%PDF-");

    expect((await get("format=zip&from=2026-09-28&to=2026-09-28")).status).toBe(400);
    expect(
      (
        await exportRoute.GET(
          new NextRequest(new URL("/api/v1/reports/export?format=csv", origin), { headers: { host: "localhost:3000" } }),
          { params: Promise.resolve({}) },
        )
      ).status,
    ).toBe(401);
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "report.exported"));
    expect(audits).toHaveLength(3);
  });
});
