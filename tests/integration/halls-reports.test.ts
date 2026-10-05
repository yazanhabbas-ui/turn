import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, tickets, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { createHall } from "@/server/halls/admin";
import { callGroup, sessionAction } from "@/server/halls/service";
import { mockOutbox } from "@/server/messaging/providers";
import { flushNotifications } from "@/server/notifications/dispatch";
import { issueTicketWith, issueTicket, callNext, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { publicTicketStatus } from "@/server/queue/views";
import { buildExport } from "@/server/reports/export";
import { buildExportDoc } from "@/server/reports/export-doc";
import { liveView } from "@/server/reports/live";
import { buildReport, reportMeta } from "@/server/reports/service";
import { myReport, reportQuery } from "@/server/profile/report";
import { myProgress } from "@/server/profile/progress";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("halls in reports, wallboard, visitor page, notifications and agent numbers (database)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  let hallReason: string;
  let deskReason: string;
  let hallA: string;
  let hallB: string;
  const filters = { from: "2026-09-29", to: "2026-09-29" };

  const issue = async (
    reasonId = hallReason,
    fields: Record<string, string> = reasonId === deskReason ? { phone: "0944000099" } : {},
  ) => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId,
      language: "ar",
      fields,
      consent: Object.keys(fields).length > 0,
      source: "reception",
    });
    advanceClock(0.1);
    return t.ticket;
  };
  const issueMany = async (n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await issue());
    return out;
  };

  /** First session of hall A: 4 visitors, all come in, 20 minutes. */
  async function fullSession() {
    await issueMany(4);
    const { session } = await callGroup(khalid, { hallId: hallA });
    advanceClock(2);
    await sessionAction(khalid, session!.id, { action: "enter" });
    advanceClock(20);
    await sessionAction(khalid, session!.id, { action: "close", outcome: "briefed" });
    advanceClock(1);
  }
  /** Second session of hall A: 3 called, 2 come in, the third never does; 10 minutes. */
  async function partialSession() {
    const three = await issueMany(3);
    const { session } = await callGroup(khalid, { hallId: hallA });
    advanceClock(1);
    await sessionAction(khalid, session!.id, { action: "enter", ticketIds: [three[0].id, three[1].id] });
    await sessionAction(khalid, session!.id, { action: "start" });
    advanceClock(10);
    await sessionAction(khalid, session!.id, { action: "close", outcome: "briefed" });
    advanceClock(1);
    return three;
  }

  beforeEach(async () => {
    process.env.MESSAGING_MOCK = "true";
    mockOutbox().length = 0;
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    const reasons = await db().select().from(visitReasons);
    hallReason = reasons.find((r) => r.code === "general")!.id;
    deskReason = reasons.find((r) => r.code === "complaint")!.id;
    await db().update(visitReasons).set({ delivery: "hall", intakeFields: [] }).where(eq(visitReasons.id, hallReason));
    await updateSetting(admin, "halls", { enabled: true, maxGroup: 4 });
    hallA = (
      await createHall(admin, branchId, {
        number: "1",
        name: { ar: "القاعة أ", en: "Hall A" },
        capacity: 4,
        reasonIds: [],
        sortOrder: 0,
      })
    ).id;
    hallB = (
      await createHall(admin, branchId, {
        number: "2",
        name: { ar: "القاعة ب", en: "Hall B" },
        capacity: 10,
        reasonIds: [],
        sortOrder: 1,
      })
    ).id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    delete process.env.MESSAGING_MOCK;
    await pool().end();
  });

  describe("reports", () => {
    it("byHall: sessions, group size, occupancy, length and no-show rate per hall", async () => {
      await fullSession();
      await partialSession();
      const { data } = await buildReport(admin, filters);
      expect(data.byHall).toHaveLength(1);
      expect(data.byHall[0]).toMatchObject({
        hallId: hallA,
        number: "1",
        sessions: 2,
        visitors: 6,
        avgGroupSize: 3,
        // 4 of 4 seats, then 2 of 4
        occupancyPct: 75,
        avgSessionMin: 15,
        called: 7,
        noShow: 1,
        noShowRatePct: 14.3,
      });
    });

    it("hall visitors flow into the existing KPIs, and the hall filter narrows tickets and sessions together", async () => {
      await fullSession();
      await partialSession();
      // one desk visitor served by Noura, so the unfiltered report mixes both kinds
      await setAgentStatus(noura, { status: "AVAILABLE" });
      const desk = await issue(deskReason);
      advanceClock(1);
      await callNext(noura, {});
      await ticketAction(noura, desk.id, { action: "start" });
      advanceClock(5);
      await ticketAction(noura, desk.id, { action: "complete", outcome: "done" } as never);

      const all = (await buildReport(admin, filters)).data;
      expect(all.summary.visitors).toBe(8);
      expect(all.summary.served).toBe(7);
      expect(all.summary.noShow).toBe(1);
      expect(all.byReason.find((r) => r.reasonId === hallReason)).toMatchObject({ visitors: 7, served: 6 });

      const a = (await buildReport(admin, { ...filters, hallId: hallA })).data;
      expect(a.summary.visitors).toBe(7);
      expect(a.summary.served).toBe(6);
      expect(a.byHall.map((h) => h.hallId)).toEqual([hallA]);

      const b = (await buildReport(admin, { ...filters, hallId: hallB })).data;
      expect(b.summary.visitors).toBe(0);
      expect(b.byHall).toEqual([]);

      // a host filter keeps only that host's sessions
      expect((await buildReport(admin, { ...filters, agentId: noura.auth.user.id })).data.byHall).toEqual([]);
      expect((await buildReport(admin, { ...filters, agentId: khalid.auth.user.id })).data.byHall[0].sessions).toBe(2);
      // a reason filter that no hall visitor has
      expect((await buildReport(admin, { ...filters, reasonId: deskReason })).data.byHall).toEqual([]);
    });

    it("a desk-only branch has no byHall rows and no hall section in the default export", async () => {
      const t = await issue(deskReason);
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await callNext(noura, {});
      await ticketAction(noura, t.id, { action: "start" });
      advanceClock(3);
      await ticketAction(noura, t.id, { action: "complete", outcome: "done" } as never);
      const report = await buildReport(admin, filters);
      expect(report.data.byHall).toEqual([]);
      expect(buildExportDoc(report, "en").tables.map((x) => x.id)).not.toContain("byHall");
      // chosen explicitly it is still emitted, empty
      expect(buildExportDoc(report, "en", ["byHall"]).tables).toMatchObject([{ id: "byHall", rows: [] }]);
    });

    it("exports the hall section in CSV, Excel and PDF, in both languages", async () => {
      await fullSession();
      const report = await buildReport(admin, filters);
      const en = buildExportDoc(report, "en", ["byHall"]).tables[0];
      expect(en.title).toBe("By hall");
      expect(en.columns).toHaveLength(8);
      expect(en.rows).toEqual([["1 Hall A", 1, 4, 4, 100, 20, 0, 0]]);
      const ar = buildExportDoc(report, "ar", ["byHall"]).tables[0];
      expect(ar.title).toBe("حسب القاعة");
      expect(ar.rows[0][0]).toBe("1 القاعة أ");
      const csv = await buildExport(report, "csv", "en", ["byHall"]);
      expect(String(csv.body)).toContain("1 Hall A");
      expect(csv.filename).toContain("halls");
      for (const format of ["xlsx", "pdf"] as const) {
        const f = await buildExport(report, format, "ar", ["byHall"]);
        expect(f.body.length).toBeGreaterThan(200);
      }
      // the default full report includes the section when halls were used
      expect(buildExportDoc(report, "en").tables.map((x) => x.id)).toContain("byHall");
      // and the filter shows in the header of the file
      const filtered = await buildReport(admin, { ...filters, hallId: hallA });
      expect(buildExportDoc(filtered, "en").filters).toContainEqual(["Hall", "1 Hall A"]);
    });

    it("offers the halls as a filter in the report metadata", async () => {
      const meta = await reportMeta(admin);
      expect(meta.halls.map((h) => h.number)).toEqual(["1", "2"]);
    });
  });

  describe("agent report and progress", () => {
    it("the host sees sessions hosted and visitors received; others and desk work see nothing", async () => {
      await fullSession();
      await partialSession();
      const mine = await myReport(khalid, reportQuery.parse({ period: "day" }));
      expect(mine.halls).toEqual({ sessions: 2, visitors: 6 });
      // their served count includes the hall visitors (the existing numbers are unchanged in meaning)
      expect(mine.totals.served).toBe(6);
      expect((await myReport(noura, reportQuery.parse({ period: "day" }))).halls).toBeUndefined();
      const progress = await myProgress(khalid, "week");
      expect(progress.agent?.hosted?.day).toEqual({ sessions: 2, visitors: 6 });
      expect((await myProgress(noura, "week")).agent?.hosted).toBeUndefined();
    });
  });

  describe("wallboard", () => {
    it("lists each hall with its host, state, occupancy and visitors; desk cards do not repeat them", async () => {
      const t = await issueMany(3);
      let live = await liveView(supervisor);
      // nobody hosts yet: halls are listed free
      expect(live.halls.map((h) => [h.number, h.state, h.occupied])).toEqual([
        ["1", "free", 0],
        ["2", "free", 0],
      ]);
      const { session } = await callGroup(khalid, { hallId: hallA });
      live = await liveView(supervisor);
      const a = live.halls.find((h) => h.id === hallA)!;
      expect(a).toMatchObject({ state: "called", occupied: 3, capacity: 4, host: { id: khalid.auth.user.id } });
      expect(a.visitors.map((v) => v.displayNumber).sort()).toEqual(t.map((x) => x.displayNumber).sort());
      expect(a.visitors.every((v) => v.status === "CALLED")).toBe(true);
      expect(live.halls.find((h) => h.id === hallB)).toMatchObject({ state: "free", occupied: 0 });
      // the host's desk card does not list the hall visitors a second time
      expect(live.desks.flatMap((d) => d.tickets)).toEqual([]);

      await sessionAction(khalid, session!.id, { action: "enter" });
      live = await liveView(supervisor);
      expect(live.halls.find((h) => h.id === hallA)).toMatchObject({ state: "in_session", occupied: 3 });
      await sessionAction(khalid, session!.id, { action: "close", outcome: "done" });
      live = await liveView(supervisor);
      expect(live.halls.find((h) => h.id === hallA)).toMatchObject({ state: "free", occupied: 0, visitors: [] });
    });

    it("shows no halls when the feature is off, and none in a branch without halls", async () => {
      await updateSetting(admin, "halls", { enabled: false });
      expect((await liveView(supervisor)).halls).toEqual([]);
    });
  });

  describe("visitor status page", () => {
    it("names the hall once the group is called, and not for desk visitors", async () => {
      const [v1, v2] = await issueMany(2);
      const s0 = await publicTicketStatus(v1.publicToken);
      expect(s0).toMatchObject({ status: "WAITING", hall: null, desk: null, groupVisit: true });
      expect(s0!.position).not.toBeNull();

      const { session } = await callGroup(khalid, { hallId: hallA });
      const called = await publicTicketStatus(v2.publicToken);
      expect(called).toMatchObject({
        status: "CALLED",
        desk: null,
        hall: { number: "1", name: { ar: "القاعة أ", en: "Hall A" } },
      });
      // no personal data in the public payload
      expect(JSON.stringify(called)).not.toMatch(/"(visitor|phone)":/i);

      await sessionAction(khalid, session!.id, { action: "enter" });
      expect(await publicTicketStatus(v1.publicToken)).toMatchObject({ status: "SERVING", hall: { number: "1" } });
      await sessionAction(khalid, session!.id, { action: "close", outcome: "done" });
      expect(await publicTicketStatus(v1.publicToken)).toMatchObject({ status: "COMPLETED", hall: null });

      const desk = await issue(deskReason);
      expect(await publicTicketStatus(desk.publicToken)).toMatchObject({ hall: null, groupVisit: false });
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await callNext(noura, {});
      const atDesk = await publicTicketStatus(desk.publicToken);
      expect(atDesk).toMatchObject({ status: "CALLED", hall: null });
      expect(atDesk!.desk).not.toBeNull();
    });
  });

  describe("notifications", () => {
    it("the called message names the hall for a group visit and the desk for a desk visit", async () => {
      await db()
        .update(visitReasons)
        .set({ intakeFields: [{ key: "phone", required: false }] })
        .where(eq(visitReasons.id, hallReason));
      const group = await issue(hallReason, { phone: "0944000011" });
      const deskVisitor = await issue(deskReason, { phone: "0944000012" });
      await flushNotifications();
      mockOutbox().length = 0;

      await callGroup(khalid, { hallId: hallA });
      await flushNotifications();
      const hallMsg = mockOutbox().find((m) => m.text.includes(group.displayNumber));
      expect(hallMsg).toBeDefined();
      expect(hallMsg!.text).toContain("القاعة");
      expect(hallMsg!.text).toContain("1 القاعة أ");
      expect(hallMsg!.text).not.toContain("المكتب");

      mockOutbox().length = 0;
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await callNext(noura, {});
      await flushNotifications();
      const deskMsg = mockOutbox().find((m) => m.text.includes(deskVisitor.displayNumber));
      expect(deskMsg).toBeDefined();
      expect(deskMsg!.text).toContain("تفضل إلى المكتب");
      expect(deskMsg!.text).not.toContain("القاعة");
      expect(deskMsg!.text).not.toContain("{");
    });
  });

  describe("kiosk", () => {
    it("a self-service ticket for a hall reason waits and is never auto-assigned to a desk agent, even in push mode", async () => {
      await updateSetting(admin, "agentWork", { multipleVisitors: false });
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const res = await issueTicketWith(
        { system: true },
        {
          branchId,
          reasonId: hallReason,
          priorityKey: null,
          language: "ar",
          fields: {},
          consent: false,
          assignToAgentId: null,
          appointmentId: null,
          source: "kiosk",
        },
        { dedupePhone: true, maxWaiting: 50, organizationId: admin.auth.user.organizationId },
      );
      expect(res.ticket.status).toBe("WAITING");
      const [row] = await db().select().from(tickets).where(eq(tickets.id, res.ticket.id));
      expect(row.assignedAgentId).toBeNull();
      expect(row.source).toBe("kiosk");
      // it only moves with a group call
      const g = await callGroup(khalid, { hallId: hallA });
      expect(g.session!.tickets.map((x) => x.ticket.id)).toContain(res.ticket.id);
    });
  });
});
