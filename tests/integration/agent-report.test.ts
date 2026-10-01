import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, tickets, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { advanceClock, setClock } from "@/server/clock";
import { submitFeedback } from "@/server/feedback/service";
import { AppError } from "@/server/http/errors";
import { activityQuery, myActivity } from "@/server/profile/activity";
import { setOwnAvatar } from "@/server/profile/avatar";
import { detailsQuery, myReport, myReportDetails, reportQuery } from "@/server/profile/report";
import { buildMyReportExport } from "@/server/profile/report-export";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";
import sharp from "sharp";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason),
  );
}

const day = reportQuery.parse({ period: "day" });
const details = (o: Record<string, unknown> = {}) => detailsQuery.parse(o);

describe.runIf(available)("agent reports on the profile (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};
  let colleagueTicket: string;
  let complaintTicket: string;

  /** Issued at reception, served by Khalid: waits 2 min, served for `service` min. */
  async function visit(code: string, service: number, extra: Record<string, string> = {}) {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      fields: extra,
      consent: Object.keys(extra).length > 0,
      source: "reception",
    });
    advanceClock(2);
    await callNext(khalid, {});
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    advanceClock(service);
    await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "done" } as never);
    advanceClock(1);
    return t.ticket;
  }

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).where(eq(branches.code, "DAM-01"));
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
    await setAgentStatus(khalid, { status: "AVAILABLE" });

    const a = await visit("general", 6);
    await submitFeedback(a.publicToken, { score: 5, comment: "very quick", language: "en" });
    const b = await visit("complaint", 10, { name: "Sami Tester", phone: "0555000222" });
    complaintTicket = b.id;
    const c = await visit("general", 4);
    // One of the visits was really Noura's: the report of each agent must only hold their own.
    colleagueTicket = c.id;
    await db().update(tickets).set({ servingAgentId: noura.auth.user.id }).where(eq(tickets.id, c.id));
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("holds only the agent's own served tickets", async () => {
    const mine = await myReport(khalid, day);
    expect(mine.totals).toMatchObject({ served: 2, noShows: 0, avgServiceMin: 8, avgWaitMin: 2, resolvedPct: 100 });
    expect(mine.byReason.map((r) => r.count).reduce((a, b) => a + b, 0)).toBe(2);
    expect(mine.csat).toMatchObject({ avg: 5, responses: 1 });
    expect(mine.csat!.comments[0].comment).toBe("very quick");

    const theirs = await myReport(noura, day);
    expect(theirs.totals.served).toBe(1);
    expect(theirs.csat?.responses).toBe(0);

    const rowsMine = (await myReportDetails(khalid, day, details())).items;
    expect(rowsMine.map((r) => r.id)).not.toContain(colleagueTicket);
    expect(rowsMine).toHaveLength(2);
    expect((await myReportDetails(noura, day, details())).items.map((r) => r.id)).toEqual([colleagueTicket]);

    // The branch comparison is a total (three visits between the two agents), never a list of colleagues.
    expect(mine.comparison.branch?.served).toBe(3);
    expect(JSON.stringify(mine)).not.toContain(noura.auth.user.id);
  });

  it("respects the date range, the 92-day limit and the previous-period comparison", async () => {
    const other = await myReport(khalid, reportQuery.parse({ from: "2026-09-28", to: "2026-09-28" }));
    expect(other.totals.served).toBe(0);
    expect(other.daily).toEqual([]);
    const week = await myReport(khalid, reportQuery.parse({ from: "2026-09-27", to: "2026-09-29" }));
    expect(week.totals.served).toBe(2);
    expect(week.daily.map((d) => d.date)).toEqual(["2026-09-29"]);
    const next = await myReport(khalid, reportQuery.parse({ from: "2026-09-30", to: "2026-09-30" }));
    expect(next.comparison.previous.served).toBe(2); // yesterday for a one-day range is 09-29
    expect(next.comparison.change.served.changePct).toBe(-100);

    await expectCode(myReport(khalid, reportQuery.parse({ from: "2026-06-30", to: "2026-09-30" })), "validation");
    await expectCode(myReport(khalid, reportQuery.parse({ from: "2026-09-30", to: "2026-09-29" })), "validation");
    expect(() => reportQuery.parse({})).toThrow();
  });

  it("pages the detail table with a cursor and filters by outcome and reason", async () => {
    const p1 = await myReportDetails(khalid, day, details({ limit: 1 }));
    expect(p1.items).toHaveLength(1);
    expect(p1.next).not.toBeNull();
    const p2 = await myReportDetails(khalid, day, details({ limit: 1, before: p1.next! }));
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
    expect(p2.next).toBeNull();
    expect(p1.items[0]).toMatchObject({ status: "COMPLETED", waitMin: 2 });

    expect((await myReportDetails(khalid, day, details({ outcome: "NO_SHOW" }))).items).toEqual([]);
    const byReason = await myReportDetails(khalid, day, details({ reasonId: reason.complaint }));
    expect(byReason.items.map((r) => r.id)).toEqual([complaintTicket]);
    expect(byReason.items[0]).toMatchObject({ serviceMin: 10, score: null });
  });

  it("is for agents only", async () => {
    await expectCode(myReport(admin, day), "forbidden", "agents_only");
    await expectCode(myReportDetails(reception, day, details()), "forbidden", "agents_only");
    await expectCode(buildMyReportExport(admin, day, "csv", "en", admin.auth.user.displayName), "forbidden", "agents_only");
  });

  it("gives agents served tickets only in the activity endpoint (no audit rows, no issued rows); others are unchanged", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } })
      .png()
      .toBuffer();
    await setOwnAvatar(khalid, png);
    await setOwnAvatar(admin, png);
    for (const type of ["all", "audit", "tickets"] as const) {
      const a = await myActivity(khalid, activityQuery.parse({ type }));
      expect(a.items.length).toBe(2);
      expect(a.items.every((i) => i.kind === "ticket" && i.role === "served")).toBe(true);
    }
    const staff = await myActivity(admin, activityQuery.parse({ type: "audit" }));
    expect(staff.items.length).toBeGreaterThan(0);
    expect(staff.items.every((i) => i.kind === "audit")).toBe(true);
    // Reception (not an agent) still sees the tickets it issued.
    expect((await myActivity(reception, activityQuery.parse({ type: "tickets" }))).items.some((i) => i.kind === "ticket")).toBe(
      true,
    );
  });

  it("masks the visitor's phone unless the viewer holds visitors.privacy", async () => {
    const masked = (await myReportDetails(khalid, day, details({ reasonId: reason.complaint }))).items[0];
    expect(masked.visitorName).toBe("Sami Tester");
    expect(masked.visitorPhone).toBe("••••222");
    expect(JSON.stringify(masked)).not.toContain("555000222");

    const privileged: Actor = {
      ...khalid,
      auth: { ...khalid.auth, grants: [...khalid.auth.grants, { branchId: null, permissions: ["visitors.privacy"] }] },
    };
    const full = (await myReportDetails(privileged, day, details({ reasonId: reason.complaint }))).items[0];
    expect(full.visitorPhone).toBe("+963555000222");

    const csv = (await buildMyReportExport(khalid, day, "csv", "en", khalid.auth.user.displayName)).body.toString("utf8");
    expect(csv).toContain("••••222");
    expect(csv).not.toContain("555000222");
    const csvFull = (await buildMyReportExport(privileged, day, "csv", "en", khalid.auth.user.displayName)).body.toString("utf8");
    expect(csvFull).toContain("+963555000222");
  });

  it("exports CSV, Excel and PDF with the summary, daily, byReason and details tables, own tickets only", async () => {
    const csvFile = await buildMyReportExport(khalid, day, "csv", "en", khalid.auth.user.displayName);
    expect(csvFile).toMatchObject({ filename: "dor-my-report-2026-09-29_2026-09-29.csv" });
    expect(csvFile.contentType).toContain("text/csv");
    const csv = csvFile.body.toString("utf8");
    for (const title of ["My work report", "Summary", "Daily summary", "By visit reason", "Served visitors"])
      expect(csv).toContain(title);
    const colleagueNumber = (await db().select().from(tickets).where(eq(tickets.id, colleagueTicket)))[0].displayNumber;
    expect(csv).not.toContain(colleagueNumber);
    expect(csv).toContain("Sami Tester");

    const xlsxFile = await buildMyReportExport(khalid, day, "xlsx", "ar", khalid.auth.user.displayName);
    expect(xlsxFile.contentType).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxFile.body as never);
    expect(wb.worksheets).toHaveLength(4);
    const detailSheet = wb.worksheets[3];
    expect(detailSheet.actualRowCount).toBeGreaterThanOrEqual(3); // header + two visits
    const daily = wb.worksheets[1];
    const last = daily.getRow(daily.actualRowCount);
    expect(last.getCell(2).value).toBe(2); // totals row: served

    const pdf = await buildMyReportExport(khalid, day, "pdf", "ar", khalid.auth.user.displayName);
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");

    // Each agent gets only their own: Noura's file has one visit.
    const nouraCsv = (await buildMyReportExport(noura, day, "csv", "en", noura.auth.user.displayName)).body.toString("utf8");
    expect(nouraCsv).toContain(colleagueNumber);
    expect(nouraCsv).not.toContain("Sami Tester");
  });
});
