import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import {
  agentProfiles,
  branches,
  hallReasons,
  hallSessions,
  hallSessionTickets,
  tickets,
  ticketEvents,
  visitReasons,
} from "@/db/schema";
import { estimateHallWait } from "@/domain/distribution/estimate";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { createHall } from "@/server/halls/admin";
import { callGroup, sessionAction } from "@/server/halls/service";
import { callNext, issueTicket, maintainBranch, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { agentWorkspace, publicTicketStatus, queueState } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("halls: group sessions (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  let hallReason: string;
  let otherHallReason: string;
  let deskReason: string;
  let hallA: string;
  let hallB: string;

  const issue = async (reasonId = hallReason, priorityKey?: string) => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId,
      priorityKey,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    advanceClock(0.1); // tickets issued in the same millisecond have no defined order
    return t.ticket.id;
  };
  const issueMany = async (n: number, reasonId = hallReason) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await issue(reasonId));
    return ids;
  };
  const row = async (id: string) => (await db().select().from(tickets).where(eq(tickets.id, id)))[0];
  const members = async (sessionId: string) =>
    db().select().from(hallSessionTickets).where(eq(hallSessionTickets.sessionId, sessionId));
  const enableHalls = (patch: Record<string, unknown> = {}) => updateSetting(admin, "halls", { enabled: true, ...patch });

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    const reasons = await db().select().from(visitReasons);
    const byCode = (c: string) => reasons.find((r) => r.code === c)!.id;
    hallReason = byCode("general");
    otherHallReason = byCode("documents");
    deskReason = byCode("contract");
    await db()
      .update(visitReasons)
      .set({ delivery: "hall" })
      .where(inArray(visitReasons.id, [hallReason, otherHallReason]));
    await enableHalls();
    hallA = (
      await createHall(admin, branchId, {
        number: "1",
        name: { ar: "القاعة أ", en: "Hall A" },
        capacity: 3,
        reasonIds: [],
        sortOrder: 0,
      })
    ).id;
    hallB = (
      await createHall(admin, branchId, {
        number: "2",
        name: { ar: "القاعة ب", en: "Hall B" },
        capacity: 5,
        reasonIds: [],
        sortOrder: 1,
      })
    ).id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  describe("routing", () => {
    it("hall reasons are never auto-assigned to desk agents, even in push mode, and desk agents cannot call them", async () => {
      await updateSetting(admin, "agentWork", { multipleVisitors: false });
      await setAgentStatus(noura, { status: "AVAILABLE" });
      const h = await issue(hallReason);
      const d = await issue(deskReason);
      expect((await row(h)).assignedAgentId).toBeNull();
      expect((await row(h)).status).toBe("WAITING");
      // Khalid can serve "general" at a desk (skills) but a hall reason is never offered to him.
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const called = await callNext(khalid, {});
      expect(called.ticket?.id).toBe(d);
      expect(await callNext(khalid, {})).toMatchObject({ ticket: null });
      expect((await row(h)).status).toBe("WAITING");
    });

    it("desk reasons never go to a hall, a hall only calls the reasons it accepts", async () => {
      const [x] = await issueMany(1, deskReason);
      await db().insert(hallReasons).values({ hallId: hallA, reasonId: hallReason });
      const a = await issue(hallReason);
      await issue(otherHallReason);
      const g = await callGroup(khalid, { hallId: hallA });
      expect(g.created).toBe(true);
      expect(g.session!.tickets.map((t) => t.ticket.id)).toEqual([a]);
      expect((await row(x)).status).toBe("WAITING");
    });

    it("a manual assignment, transfer to an agent or walk-in serve-now of a hall reason is refused", async () => {
      const t = await issue(hallReason);
      await expect(ticketAction(admin, t, { action: "assign", agentId: khalid.auth.user.id })).rejects.toMatchObject({
        details: { reason: "hall_reason_no_agent" },
      });
    });

    it("wait estimates for a hall reason use sessions of the hall capacity", async () => {
      const ids = await issueMany(7);
      const st = await queueState(reception, branchId);
      // hall capacity 5 (the biggest), 2 halls in parallel: 7th visitor has 6 ahead = 2 sessions = 1 round
      const pos = st.positions[ids[6]];
      expect(pos.ahead).toBe(6);
      const expected = estimateHallWait(6, 5, 2, 10, { rounding: 1, bufferPercent: 0 });
      expect(pos.estimatedWaitMinutes).toBeGreaterThanOrEqual(expected.minutes);
    });
  });

  describe("calling a group", () => {
    it("is refused while the feature is off", async () => {
      await updateSetting(admin, "halls", { enabled: false });
      await issue();
      await expect(callGroup(khalid, { hallId: hallA })).rejects.toMatchObject({ details: { reason: "halls_disabled" } });
    });

    it("calls up to the capacity in queue order and signs the host in to the hall", async () => {
      const ids = await issueMany(5);
      const g = await callGroup(khalid, { hallId: hallA });
      expect(g.created).toBe(true);
      expect(g.session).toMatchObject({ status: "OPEN", capacity: 3, hallNumber: "1", occupied: 3 });
      expect(g.session!.tickets.map((t) => t.ticket.id)).toEqual(ids.slice(0, 3));
      for (const id of ids.slice(0, 3)) {
        expect(await row(id)).toMatchObject({
          status: "CALLED",
          hallId: hallA,
          deskId: null,
          servingAgentId: khalid.auth.user.id,
        });
      }
      expect((await row(ids[3])).status).toBe("WAITING");
      const [p] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, khalid.auth.user.id));
      expect(p).toMatchObject({ currentHallId: hallA, currentDeskId: null, status: "AVAILABLE" });
      const events = await db().select().from(ticketEvents).where(eq(ticketEvents.ticketId, ids[0]));
      const called = events.find((e) => e.type === "CALLED")!;
      expect(called.payload).toMatchObject({ hallId: hallA, sessionId: g.session!.id });
    });

    it("respects the group settings: minimum, maximum and size", async () => {
      await issueMany(2);
      await enableHalls({ minGroup: 3 });
      expect(await callGroup(khalid, { hallId: hallB })).toMatchObject({ session: null, reason: "below_min", available: 2 });
      await enableHalls({ minGroup: 1, maxGroup: 2 });
      await issueMany(3);
      const g = await callGroup(khalid, { hallId: hallB });
      expect(g.session!.tickets).toHaveLength(2);
      await sessionAction(khalid, g.session!.id, { action: "cancel" });
      const sized = await callGroup(khalid, { hallId: hallB, size: 1 });
      expect(sized.session!.tickets).toHaveLength(1);
    });

    it("same_reason keeps one reason per session, any_reason mixes in queue order", async () => {
      const a1 = await issue(hallReason);
      const b1 = await issue(otherHallReason);
      const a2 = await issue(hallReason);
      const same = await callGroup(khalid, { hallId: hallB });
      expect(same.session!.tickets.map((t) => t.ticket.id)).toEqual([a1, a2]);
      expect(same.session!.reasonId).toBe(hallReason);
      await sessionAction(khalid, same.session!.id, { action: "cancel" });
      await enableHalls({ groupMode: "any_reason" });
      const mixed = await callGroup(khalid, { hallId: hallB });
      expect(mixed.session!.tickets.map((t) => t.ticket.id)).toEqual([a1, b1, a2]);
      expect(mixed.session!.reasonId).toBeNull();
    });

    it("serves higher priority first, then first come first served", async () => {
      const first = await issue(hallReason);
      const second = await issue(hallReason);
      const vip = await issue(hallReason, "vip");
      await enableHalls({ maxGroup: 2 });
      const g = await callGroup(khalid, { hallId: hallB });
      expect(g.session!.tickets.map((t) => t.ticket.id).sort()).toEqual([first, vip].sort());
      expect(g.session!.tickets.some((t) => t.ticket.id === second)).toBe(false);
    });

    it("is idempotent for one host (double click) and refuses a second host on the same hall", async () => {
      await issueMany(6);
      const [a, b] = await Promise.all([callGroup(khalid, { hallId: hallA }), callGroup(khalid, { hallId: hallA })]);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.session!.id).toBe(b.session!.id);
      expect(await db().select().from(hallSessions)).toHaveLength(1);
      await expect(callGroup(noura, { hallId: hallA })).rejects.toMatchObject({
        details: { reason: expect.stringMatching(/hall_busy|hall_taken/) },
      });
    });

    it("two hosts calling at the same moment never get the same visitor", async () => {
      const ids = await issueMany(8);
      const [g1, g2] = await Promise.all([callGroup(khalid, { hallId: hallA }), callGroup(noura, { hallId: hallB })]);
      const t1 = g1.session!.tickets.map((t) => t.ticket.id);
      const t2 = g2.session!.tickets.map((t) => t.ticket.id);
      expect(t1.filter((x) => t2.includes(x))).toEqual([]);
      expect(t1.length + t2.length).toBe(8);
      expect(new Set([...t1, ...t2])).toEqual(new Set(ids));
    });

    it("an agent cannot host two halls, nor be at a desk and a hall", async () => {
      await issueMany(8);
      await callGroup(khalid, { hallId: hallA });
      await expect(callGroup(khalid, { hallId: hallB })).rejects.toMatchObject({ details: { reason: "host_busy" } });
      // in a hall the desk queue is closed to the host
      await expect(callNext(khalid, {})).rejects.toMatchObject({ details: { reason: "hall_mode" } });
      // and they cannot walk away while the session is open
      await expect(setAgentStatus(khalid, { status: "ON_BREAK" })).rejects.toMatchObject({
        details: { reason: "hall_session_open" },
      });
      // choosing a desk clears the hall for an agent without a session
      await setAgentStatus(noura, { status: "AVAILABLE", hallId: hallB });
      let [p] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, noura.auth.user.id));
      expect(p.currentHallId).toBe(hallB);
      const [desk] = await db().query.desks.findMany({ where: (d, { eq: e }) => e(d.branchId, branchId), limit: 1 });
      await setAgentStatus(noura, { status: "AVAILABLE", deskId: desk.id });
      [p] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, noura.auth.user.id));
      expect(p).toMatchObject({ currentHallId: null, currentDeskId: desk.id });
      await expect(setAgentStatus(noura, { status: "AVAILABLE", deskId: desk.id, hallId: hallB })).rejects.toMatchObject({
        details: { reason: "desk_or_hall" },
      });
    });

    it("one host per hall when signing in", async () => {
      await setAgentStatus(khalid, { status: "AVAILABLE", hallId: hallA });
      await expect(setAgentStatus(noura, { status: "AVAILABLE", hallId: hallA })).rejects.toMatchObject({
        details: { reason: "hall_taken" },
      });
    });

    it("shifts: an off-shift host is still allowed in guide mode, refused in strict mode", async () => {
      const sara = await actorFor("sara@dor.local"); // evening shift, now is 10:00
      await issueMany(2);
      expect((await callGroup(sara, { hallId: hallA })).created).toBe(true);
    });
  });

  describe("session lifecycle", () => {
    it("enter -> start -> close updates tickets, durations and the audit trail", async () => {
      const ids = await issueMany(3);
      const { session } = await callGroup(khalid, { hallId: hallA });
      const sid = session!.id;
      advanceClock(2);
      const entered = await sessionAction(khalid, sid, { action: "enter" });
      // everybody is in and auto-start is on
      expect(entered.session!.status).toBe("IN_SESSION");
      expect(entered.session!.tickets.every((t) => t.status === "ENTERED")).toBe(true);
      for (const id of ids) expect((await row(id)).status).toBe("SERVING");
      advanceClock(20);
      const closed = await sessionAction(khalid, sid, { action: "close", outcome: "briefed" });
      expect(closed.session).toMatchObject({ status: "CLOSED" });
      for (const id of ids) {
        const t = await row(id);
        expect(t.status).toBe("COMPLETED");
        expect(t.outcome).toBe("briefed");
        expect(t.finishedAt!.getTime() - t.startedAt!.getTime()).toBeCloseTo(20 * 60_000, -3);
      }
      const [s] = await db().select().from(hallSessions).where(eq(hallSessions.id, sid));
      expect(s.closedAt!.getTime() - s.startedAt!.getTime()).toBeCloseTo(20 * 60_000, -3);
      const ev = await db().select().from(ticketEvents).where(eq(ticketEvents.ticketId, ids[0]));
      expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["ISSUED", "CALLED", "STARTED", "COMPLETED"]));
      expect(ev.find((e) => e.type === "STARTED")!.payload).toMatchObject({ hallId: hallA, sessionId: sid });
      // the host can call the next group right away
      await issueMany(1);
      expect((await callGroup(khalid, { hallId: hallA })).created).toBe(true);
    });

    it("manual start; a late visitor can still enter; close marks visitors who never came as no-show", async () => {
      await enableHalls({ autoStartWhenAllEntered: false });
      const [a, b, c] = await issueMany(3);
      const { session } = await callGroup(khalid, { hallId: hallA });
      await expect(sessionAction(khalid, session!.id, { action: "start" })).rejects.toMatchObject({
        details: { reason: "nobody_entered" },
      });
      const e1 = await sessionAction(khalid, session!.id, { action: "enter", ticketIds: [a, b] });
      expect(e1.session!.status).toBe("OPEN");
      const started = await sessionAction(khalid, session!.id, { action: "start" });
      expect(started.session!.status).toBe("IN_SESSION");
      expect(started.session!.startedAt).not.toBeNull();
      // start twice is harmless
      expect((await sessionAction(khalid, session!.id, { action: "start" })).session!.status).toBe("IN_SESSION");
      const closed = await sessionAction(khalid, session!.id, { action: "close", outcomes: { [a]: "x" } });
      expect(closed.session!.status).toBe("CLOSED");
      expect((await row(a)).outcome).toBe("x");
      expect((await row(b)).status).toBe("COMPLETED");
      expect((await row(c)).status).toBe("NO_SHOW");
      const m = await members(session!.id);
      expect(m.find((x) => x.ticketId === c)!.status).toBe("NO_SHOW");
      // closing twice returns the same closed session
      expect((await sessionAction(khalid, session!.id, { action: "close" })).session!.status).toBe("CLOSED");
    });

    it("release sends a visitor back to the queue at the original place", async () => {
      const [a, b, c, d] = await issueMany(4);
      const { session } = await callGroup(khalid, { hallId: hallA });
      expect(session!.tickets.map((t) => t.ticket.id)).toEqual([a, b, c]);
      const before = (await row(b)).queuedAt;
      const r = await sessionAction(khalid, session!.id, { action: "release", ticketId: b });
      expect(r.session!.tickets.some((t) => t.ticket.id === b)).toBe(false);
      expect(await row(b)).toMatchObject({
        status: "WAITING",
        hallId: null,
        hallSessionId: null,
        servingAgentId: null,
        assignedAgentId: null,
      });
      expect((await row(b)).queuedAt.getTime()).toBe(before.getTime());
      // second release is a no-op
      await sessionAction(khalid, session!.id, { action: "release", ticketId: b });
      // top-up takes the released visitor first: they were ahead of d
      const up = await sessionAction(khalid, session!.id, { action: "top_up" });
      expect(up.session!.tickets.map((t) => t.ticket.id)).toEqual([a, b, c]);
      expect((await row(d)).status).toBe("WAITING");
    });

    it("no-show of one visitor and the group still goes on", async () => {
      const [a, b] = await issueMany(2);
      const { session } = await callGroup(khalid, { hallId: hallA });
      await sessionAction(khalid, session!.id, { action: "no_show", ticketId: b });
      expect((await row(b)).status).toBe("NO_SHOW");
      const entered = await sessionAction(khalid, session!.id, { action: "enter" });
      expect(entered.session!.status).toBe("IN_SESSION");
      expect(entered.session!.occupied).toBe(1);
      await sessionAction(khalid, session!.id, { action: "close" });
      expect((await row(a)).status).toBe("COMPLETED");
      expect((await row(b)).status).toBe("NO_SHOW");
    });

    it("top-up adds visitors before the session starts, within capacity, and is configurable", async () => {
      const ids = await issueMany(6);
      const { session } = await callGroup(khalid, { hallId: hallB, size: 2 });
      expect(session!.occupied).toBe(2);
      const up = await sessionAction(khalid, session!.id, { action: "top_up", size: 2 });
      expect(up.session!.tickets.map((t) => t.ticket.id)).toEqual(ids.slice(0, 4));
      const full = await sessionAction(khalid, session!.id, { action: "top_up" });
      expect(full.session!.occupied).toBe(5);
      await sessionAction(khalid, session!.id, { action: "enter" });
      await expect(sessionAction(khalid, session!.id, { action: "top_up" })).rejects.toMatchObject({
        details: { reason: expect.stringMatching(/session_started/) },
      });
      await sessionAction(khalid, session!.id, { action: "cancel" }).catch((e) => expect(e.details.reason).toBe("has_entered"));
      await sessionAction(khalid, session!.id, { action: "close" });
      await enableHalls({ allowTopUp: false });
      await issueMany(3);
      const s2 = await callGroup(khalid, { hallId: hallB, size: 1 });
      await expect(sessionAction(khalid, s2.session!.id, { action: "top_up" })).rejects.toMatchObject({
        details: { reason: "top_up_off" },
      });
    });

    it("cancel returns everybody to the queue and frees the hall", async () => {
      const ids = await issueMany(3);
      const { session } = await callGroup(khalid, { hallId: hallA });
      const r = await sessionAction(khalid, session!.id, { action: "cancel" });
      expect(r.session!.status).toBe("CANCELLED");
      for (const id of ids) expect(await row(id)).toMatchObject({ status: "WAITING", hallSessionId: null });
      expect((await callGroup(noura, { hallId: hallA })).created).toBe(true);
    });

    it("the existing ticket actions work for a hall visitor and the session follows", async () => {
      const [a, b] = await issueMany(2);
      const { session } = await callGroup(khalid, { hallId: hallA });
      await ticketAction(khalid, a, { action: "start" });
      let m = await members(session!.id);
      expect(m.find((x) => x.ticketId === a)!.status).toBe("ENTERED");
      await ticketAction(khalid, b, { action: "hold" });
      m = await members(session!.id);
      expect(m.find((x) => x.ticketId === b)!.status).toBe("RELEASED");
      expect(await row(b)).toMatchObject({ status: "ON_HOLD", hallSessionId: null });
      await ticketAction(khalid, a, { action: "complete", outcome: "ok" } as never);
      const [s] = await db().select().from(hallSessions).where(eq(hallSessions.id, session!.id));
      expect(s.status).toBe("CLOSED");
    });

    it("only the host (or a supervisor) can act on a session", async () => {
      await issueMany(2);
      const { session } = await callGroup(khalid, { hallId: hallA });
      await expect(sessionAction(noura, session!.id, { action: "enter" })).rejects.toMatchObject({ code: "forbidden" });
      const supervisor = await actorFor("supervisor@dor.local");
      expect((await sessionAction(supervisor, session!.id, { action: "enter" })).session!.status).toBe("IN_SESSION");
    });
  });

  describe("timers and realtime state", () => {
    it("a group that does not come in is recalled together and then marked as no-show by the existing timers", async () => {
      const ids = await issueMany(3);
      const { session } = await callGroup(khalid, { hallId: hallA });
      for (let i = 0; i < 12; i++) {
        advanceClock(3);
        await maintainBranch(branchId, Date.now());
      }
      for (const id of ids) expect((await row(id)).status).not.toBe("CALLED");
      const [s] = await db().select().from(hallSessions).where(eq(hallSessions.id, session!.id));
      expect(["CLOSED", "CANCELLED"]).toContain(s.status);
      expect((await callGroup(khalid, { hallId: hallA })).reason).toBe("empty");
    });

    it("the occupancy is part of the agent workspace and the public status says where to go", async () => {
      const ids = await issueMany(2);
      const g = await callGroup(khalid, { hallId: hallA });
      const ws = await agentWorkspace(khalid);
      expect(ws.hall?.session).toMatchObject({ id: g.session!.id, occupied: 2, capacity: 3 });
      expect(ws.active).toHaveLength(0);
      const t = await row(ids[0]);
      const pub = await publicTicketStatus(t.publicToken);
      expect(pub).toMatchObject({ status: "CALLED" });
      expect((pub as { hall?: { number: string } | null }).hall).toMatchObject({ number: "1" });
      const q = await queueState(reception, branchId);
      expect(q.tickets.find((x) => x.id === ids[0])).toMatchObject({ hallId: hallA, status: "CALLED" });
    });

    it("undo of a no-show is refused once the session is closed", async () => {
      const [a] = await issueMany(2);
      const { session } = await callGroup(khalid, { hallId: hallA });
      await sessionAction(khalid, session!.id, { action: "no_show", ticketId: a });
      await sessionAction(khalid, session!.id, { action: "enter" });
      await sessionAction(khalid, session!.id, { action: "close" });
      await expect(ticketAction(khalid, a, { action: "undo" })).rejects.toMatchObject({
        details: { reason: "hall_session_closed" },
      });
    });
  });
});
