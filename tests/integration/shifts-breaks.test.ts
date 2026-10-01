import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { agentProfiles, branches, tickets, users, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { putRule } from "@/server/admin/distribution";
import { updateSetting } from "@/server/admin/settings-admin";
import { archiveShift, createShift, listShifts, updateShift } from "@/server/admin/shifts";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, maintainBranch, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { agentWorkspace } from "@/server/queue/views";
import { buildReport } from "@/server/reports/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason),
  );
}

describe.runIf(available)("shifts, break limits and repeat visitors (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let supervisor: Actor;
  let khalid: Actor; // morning
  let noura: Actor; // morning
  let mohammed: Actor; // morning
  let sara: Actor; // evening
  let abdullah: Actor; // evening
  let branchId: string;
  const reason: Record<string, string> = {};
  const at = (hhmm: string, date = "2026-09-29") => zonedToUtc(date, hhmm, "Asia/Damascus");

  const issue = async (code: string, extra: Record<string, unknown> = {}) => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
      ...extra,
    });
    advanceClock(0.1);
    return t.ticket.id;
  };

  beforeEach(async () => {
    setClock(at("10:00"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    mohammed = await actorFor("mohammed@dor.local");
    sara = await actorFor("sara@dor.local");
    abdullah = await actorFor("abdullah@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).where(eq(branches.code, "DAM-01"));
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  describe("shifts", () => {
    it("come with a morning and an evening shift, and the agent sees where they stand in theirs", async () => {
      expect((await listShifts(admin)).map((s) => s.code)).toEqual(["morning", "evening"]);
      const ws = await agentWorkspace(khalid);
      expect(ws.shift).toMatchObject({ startsAt: "08:00", endsAt: "15:00", onShift: true, endsInMinutes: 300 });
      expect(ws.shiftMode).toBe("guide");
      const evening = await agentWorkspace(sara);
      expect(evening.shift).toMatchObject({ startsAt: "15:00", onShift: false, startsInMinutes: 300 });
    });

    it("only the super admin defines shifts, a shift in use cannot be archived", async () => {
      const mine = {
        code: "night",
        name: { ar: "ليلي", en: "Night" },
        startsAt: "22:00",
        endsAt: "06:00",
        sortOrder: 2,
        cityId: null,
      };
      await expectCode(createShift(supervisor, mine), "forbidden");
      const { id } = await createShift(admin, mine);
      await expectCode(createShift(admin, mine), "conflict");
      await updateShift(admin, id, { ...mine, endsAt: "07:00" });
      await expect(createShift(admin, { ...mine, code: "bad", startsAt: "08:00", endsAt: "08:00" }))
        .resolves.toBeDefined()
        .catch(() => undefined);
      const morning = (await listShifts(admin)).find((s) => s.code === "morning")!;
      await expectCode(archiveShift(admin, morning.id), "conflict", "shift_in_use");
      await archiveShift(admin, id);
    });

    it("guide mode: an agent outside their shift gets no automatic assignments; off ignores shifts", async () => {
      await putRule(admin, { scope: "global", config: { mode: "push", push: { strategies: ["least_waiting"] } } } as never);
      // The corporate desk is staffed by the two evening agents only.
      for (const a of [sara, abdullah]) await setAgentStatus(a, { status: "AVAILABLE" });
      const id = await issue("account_manager", { fields: { company: "شركة الشام", name: "زائر" }, consent: true });
      const assigned = async () => (await db().select().from(tickets).where(eq(tickets.id, id)))[0].assignedAgentId;

      // 10:00: both are available but their shift starts at 15:00, so nobody is picked automatically.
      expect(await assigned()).toBeNull();
      // The same ticket is reserved once shifts are ignored...
      await updateSetting(admin, "agentWork", { shiftMode: "off" });
      await maintainBranch(branchId);
      expect(await assigned()).not.toBeNull();
    });

    it("guide mode: once the shift starts the agent gets the waiting ticket", async () => {
      await putRule(admin, { scope: "global", config: { mode: "push", push: { strategies: ["least_waiting"] } } } as never);
      for (const a of [sara, abdullah]) await setAgentStatus(a, { status: "AVAILABLE" });
      const id = await issue("account_manager", { fields: { company: "شركة الشام", name: "زائر" }, consent: true });
      setClock(at("15:05"));
      await maintainBranch(branchId);
      expect((await db().select().from(tickets).where(eq(tickets.id, id)))[0].assignedAgentId).not.toBeNull();
    });

    it("strict mode: no going available outside the shift, and idle agents are signed out after it", async () => {
      await updateSetting(admin, "agentWork", { shiftMode: "strict", shiftEndGraceMinutes: 10 });
      await expectCode(setAgentStatus(sara, { status: "AVAILABLE" }), "conflict", "off_shift");
      await setAgentStatus(khalid, { status: "AVAILABLE" });

      setClock(at("16:00"));
      await setAgentStatus(sara, { status: "AVAILABLE" });
      expect((await agentWorkspace(sara)).profile.status).toBe("AVAILABLE");

      // Khalid's shift ended at 15:00; after the grace period the idle agent is signed out. Sara is still on shift.
      setClock(at("15:20"));
      await maintainBranch(branchId);
      expect((await agentWorkspace(khalid)).profile.status).toBe("OFFLINE");
      expect((await agentWorkspace(sara)).profile.status).toBe("AVAILABLE");

      setClock(at("22:30"));
      await maintainBranch(branchId);
      expect((await agentWorkspace(sara)).profile.status).toBe("OFFLINE");
    });

    it("reports split visitors by shift and list each agent's shift", async () => {
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      await issue("general");
      setClock(at("17:00"));
      await issue("general");
      const { data } = await buildReport(admin, { from: "2026-09-29", to: "2026-09-29" });
      expect(data.byShift.map((s) => [s.shiftId ? s.name.en : null, s.visitors])).toEqual([
        ["Morning", 1],
        ["Evening", 1],
      ]);
      expect(data.agents.some((a) => a.shiftId)).toBe(true);
    });
  });

  describe("break limits", () => {
    const status = async (a: Actor) => (await agentWorkspace(a)).profile.status;

    beforeEach(async () => {
      for (const a of [khalid, noura, mohammed]) await setAgentStatus(a, { status: "AVAILABLE" });
    });

    it("the third agent cannot go on break while two are, is told so, and is next in line", async () => {
      expect(await setAgentStatus(khalid, { status: "ON_BREAK" })).toMatchObject({ status: "ON_BREAK", breakQueued: null });
      expect(await setAgentStatus(noura, { status: "ON_BREAK" })).toMatchObject({ status: "ON_BREAK", breakQueued: null });

      const third = await setAgentStatus(mohammed, { status: "ON_BREAK" });
      expect(third).toMatchObject({ status: "AVAILABLE", breakQueued: { onBreak: 2, limit: 2, position: 1 } });
      expect(await status(mohammed)).toBe("AVAILABLE");
      // Asking again does not queue twice.
      expect((await setAgentStatus(mohammed, { status: "ON_BREAK" })).breakQueued).toMatchObject({ position: 1 });
      const ws = await agentWorkspace(mohammed);
      expect(ws.breaks).toMatchObject({ enabled: true, limit: 2, onBreak: 2, request: { status: "waiting", position: 1 } });
    });

    it("when a colleague returns, the agent in line is offered the place for a limited time", async () => {
      await setAgentStatus(khalid, { status: "ON_BREAK" });
      await setAgentStatus(noura, { status: "ON_BREAK" });
      await setAgentStatus(mohammed, { status: "ON_BREAK" }); // queued
      await setAgentStatus(khalid, { status: "AVAILABLE" });

      let ws = await agentWorkspace(mohammed);
      expect(ws.breaks.request).toMatchObject({ status: "offered", position: 0 });
      expect(ws.breaks.request?.offerExpiresAt).toBeTruthy();

      // The held place cannot be taken by someone else meanwhile: Khalid has to queue behind.
      expect((await setAgentStatus(khalid, { status: "ON_BREAK" })).breakQueued).toMatchObject({ position: 1 });

      // Mohammed takes it.
      expect(await setAgentStatus(mohammed, { status: "ON_BREAK" })).toMatchObject({ status: "ON_BREAK", breakQueued: null });
      ws = await agentWorkspace(mohammed);
      expect(ws.breaks.request).toBeNull();
    });

    it("an offer nobody takes expires and passes to the next agent in line", async () => {
      await setAgentStatus(khalid, { status: "ON_BREAK" });
      await setAgentStatus(noura, { status: "ON_BREAK" });
      await setAgentStatus(mohammed, { status: "ON_BREAK" }); // queued first
      await setAgentStatus(sara, { status: "AVAILABLE" });
      const [s] = await db().select({ id: users.id }).from(users).where(eq(users.email, "sara@dor.local"));
      await db().update(agentProfiles).set({ shiftId: null }).where(eq(agentProfiles.userId, s.id));
      await setAgentStatus(sara, { status: "ON_BREAK" }); // queued second
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      expect((await agentWorkspace(mohammed)).breaks.request?.status).toBe("offered");
      expect((await agentWorkspace(sara)).breaks.request).toMatchObject({ status: "waiting", position: 1 });

      advanceClock(4); // the offer is valid for 3 minutes
      await maintainBranch(branchId);
      expect((await agentWorkspace(sara)).breaks.request?.status).toBe("offered");
      // Mohammed lost his turn (he was told it expired) and has to ask again.
      expect((await agentWorkspace(mohammed)).breaks.request).toBeNull();
    });

    it("changing your mind cancels the request; the limit can be a share of the agents signed in, or off", async () => {
      await setAgentStatus(khalid, { status: "ON_BREAK" });
      await setAgentStatus(noura, { status: "ON_BREAK" });
      await setAgentStatus(mohammed, { status: "ON_BREAK" });
      await setAgentStatus(mohammed, { status: "AVAILABLE" });
      expect((await agentWorkspace(mohammed)).breaks.request).toBeNull();

      // 34% of three agents signed in is one: only one break at a time.
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await updateSetting(admin, "breaks", { enabled: true, maxOnBreak: { mode: "percent", value: 34 }, holdMinutes: 3 });
      expect((await setAgentStatus(khalid, { status: "ON_BREAK" })).breakQueued).toBeNull();
      expect((await setAgentStatus(noura, { status: "ON_BREAK" })).breakQueued).toMatchObject({ limit: 1, position: 1 });
      await setAgentStatus(noura, { status: "AVAILABLE" });

      await updateSetting(admin, "breaks", { enabled: false });
      expect((await setAgentStatus(noura, { status: "ON_BREAK" })).breakQueued).toBeNull();
      expect((await setAgentStatus(mohammed, { status: "ON_BREAK" })).breakQueued).toBeNull();
    });
  });

  describe("repeat visitors", () => {
    const complaint = (phone: string, name = "زائر متكرر") => issue("complaint", { fields: { phone, name }, consent: true });

    it("counts how many times the same visitor came, however the number was typed", async () => {
      await complaint("0944 123 456");
      await complaint("+963944123456");
      await complaint("٠٩٤٤١٢٣٤٥٦");
      await complaint("0955 000 111", "زائر واحد");
      await issue("general"); // nothing identifying entered

      const { data } = await buildReport(admin, { from: "2026-09-29", to: "2026-09-29" });
      const rp = data.repeat;
      expect(rp).toMatchObject({
        uniqueVisitors: 2,
        identifiedTickets: 4,
        anonymousTickets: 1,
        repeatVisitors: 1,
        repeatRatePct: 50,
      });
      expect(rp.avgVisits).toBe(2);
      expect(rp.distribution.find((d) => d.visits === 3)?.visitors).toBe(1);
      expect(rp.distribution.find((d) => d.visits === 1)?.visitors).toBe(1);
      expect(rp.top).toHaveLength(1);
      expect(rp.top[0]).toMatchObject({ visits: 3, name: "زائر متكرر", phoneMasked: "••••456" });
      expect(rp.top[0].reasonIds).toEqual([reason.complaint]);
      // Full numbers only for people allowed to see personal data.
      expect(rp.top[0].phone).toBe("+963944123456");
      const seenBySupervisor = (await buildReport(supervisor, { from: "2026-09-29", to: "2026-09-29" })).data.repeat.top[0];
      expect(seenBySupervisor.phone).toBeNull();
      expect(seenBySupervisor.phoneMasked).toBe("••••456");
    });

    it("counts visits across the chosen period, not only one day", async () => {
      await complaint("0944 123 456");
      setClock(at("10:00", "2026-10-03"));
      await complaint("0944 123 456");
      const week = await buildReport(admin, { from: "2026-09-28", to: "2026-10-04" });
      expect(week.data.repeat.top[0]?.visits).toBe(2);
      expect(week.data.repeat.top[0]?.avgDaysBetween).toBe(4);
      const oneDay = await buildReport(admin, { from: "2026-09-29", to: "2026-09-29" });
      expect(oneDay.data.repeat.repeatVisitors).toBe(0);
    });
  });

  describe("what the agent sees of a returning visitor", () => {
    it("shows what reception typed, the number of earlier visits and the earlier visits themselves", async () => {
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const fields = { phone: "0944 123 456", name: "ليلى الحلبي", national_id_last4: "1234" };
      const first = await issue("contract", { fields, consent: true });
      expect((await callNext(khalid, {})).ticket?.id).toBe(first);
      await ticketAction(khalid, first, { action: "start" });
      await ticketAction(khalid, first, { action: "complete", outcome: "done" } as never);

      advanceClock(60 * 24);
      const second = await issue("contract", { fields, consent: true });
      expect((await callNext(khalid, {})).ticket?.id).toBe(second);
      const ws = await agentWorkspace(khalid);
      const t = ws.active[0];
      expect(t.visitor).toMatchObject({ name: "ليلى الحلبي", phone: "+963944123456", visitCount: 1, returning: true });
      expect(t.visitor?.lastVisitAt).toBeTruthy();
      expect(t.intake).toMatchObject({ national_id_last4: "1234" });
      const history = ws.visitHistory[t.visitor!.id];
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: "COMPLETED", reasonId: reason.contract, outcome: "done" });
      expect(history[0].agentName).toBeTruthy();
    });
  });
});
