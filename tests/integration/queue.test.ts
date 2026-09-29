import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import {
  agentProfiles,
  branches,
  distributionRules,
  pauseWindows,
  reasonAssignments,
  ticketEvents,
  tickets,
  users,
  visitReasons,
} from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, maintainBranch, queueState, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason),
  );
}

/** Tuesday 29 Sep 2026, 10:00 Riyadh — inside office hours, outside prayer pauses. */
const TUESDAY_10AM = zonedToUtc("2026-09-29", "10:00", "Asia/Riyadh");

describe.runIf(available)("queue engine (database)", () => {
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

  async function setMode(config: Record<string, unknown>) {
    const [org] = await db().select({ id: branches.organizationId }).from(branches);
    await db()
      .update(distributionRules)
      .set({ config })
      .where(and(eq(distributionRules.organizationId, org.id), eq(distributionRules.scope, "global")));
  }

  const issue = (code: string, extra: Record<string, unknown> = {}) =>
    issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
      ...extra,
    });
  const available_ = (a: Actor) => setAgentStatus(a, { status: "AVAILABLE" });

  beforeEach(async () => {
    setClock(TUESDAY_10AM);
    await resetDemo();
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
  });

  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("issues sequential numbers per prefix and records the ISSUED event", async () => {
    const a1 = await issue("general");
    advanceClock(0.1);
    const a2 = await issue("general");
    const b1 = await issue("contract", {
      fields: { name: "فهد", phone: "0501234567", national_id_last4: "١٢٣٤" },
      consent: true,
    });
    expect([a1.ticket.displayNumber, a2.ticket.displayNumber, b1.ticket.displayNumber]).toEqual(["A-001", "A-002", "B-001"]);
    expect(a2.ahead).toBe(1);
    expect(a2.estimatedWaitMinutes).toBeGreaterThan(0);
    const events = await db().select().from(ticketEvents).where(eq(ticketEvents.ticketId, a1.ticket.id));
    expect(events.map((e) => e.type)).toEqual(["ISSUED"]);
    expect(b1.ticket.intake).toEqual({ national_id_last4: "١٢٣٤" });
  });

  it("never duplicates numbers under concurrent issuing, and honours idempotency keys", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => issue("general")));
    const numbers = results.map((r) => r.ticket.displayNumber).sort();
    expect(new Set(numbers).size).toBe(30);
    expect(numbers[0]).toBe("A-001");
    expect(numbers[29]).toBe("A-030");
    const first = await issue("general", { idempotencyKey: "reception-tab-1-0001" });
    const again = await issue("general", { idempotencyKey: "reception-tab-1-0001" });
    expect(again.duplicate).toBe(true);
    expect(again.ticket.id).toBe(first.ticket.id);
  });

  it("enforces data minimisation, required fields and consent", async () => {
    await expectCode(issue("general", { fields: { national_id_last4: "1234" } }), "validation", "unexpected_field");
    await expectCode(issue("contract", { fields: { name: "x" }, consent: true }), "validation", "missing_field");
    await expectCode(
      issue("contract", { fields: { name: "x", phone: "0501234567", national_id_last4: "1234" } }),
      "validation",
      "consent_required",
    );
  });

  it("refuses tickets outside business hours and during the cut-off", async () => {
    setClock(zonedToUtc("2026-10-02", "10:00", "Asia/Riyadh")); // Friday
    await expectCode(issue("general"), "conflict", "closed");
    setClock(zonedToUtc("2026-09-29", "15:50", "Asia/Riyadh"));
    await expectCode(issue("documents", { fields: { national_id_last4: "1234" }, consent: true }), "conflict", "cutoff");
  });

  it("call next → recall → start → complete, with a full event trail and times", async () => {
    const t = await issue("general");
    await available_(khalid);
    advanceClock(4);
    const called = await callNext(khalid);
    expect(called.ticket?.id).toBe(t.ticket.id);
    expect(called.ticket?.status).toBe("CALLED");
    await ticketAction(khalid, t.ticket.id, { action: "recall" });
    advanceClock(1);
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    advanceClock(6);
    const done = await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "resolved" });
    expect(done.ticket.status).toBe("COMPLETED");
    const events = await db().select().from(ticketEvents).where(eq(ticketEvents.ticketId, t.ticket.id)).orderBy(ticketEvents.at);
    expect(events.map((e) => e.type)).toEqual(["ISSUED", "CALLED", "RECALLED", "STARTED", "COMPLETED"]);
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t.ticket.id));
    expect((row.startedAt!.getTime() - row.arrivedAt.getTime()) / 60_000).toBe(5);
    expect((row.finishedAt!.getTime() - row.startedAt!.getTime()) / 60_000).toBe(6);
  });

  it("two agents pressing Call next at the same moment never get the same ticket", async () => {
    const agents = await Promise.all(["khalid", "noura", "mohammed", "sara", "abdullah"].map((n) => actorFor(`${n}@dor.local`)));
    // Everyone may serve general inquiries for this test, one ticket at a time.
    const agentIds = agents.map((a) => a.auth.user.id);
    await db().delete(reasonAssignments).where(eq(reasonAssignments.reasonId, reason.general));
    await db()
      .insert(reasonAssignments)
      .values(agentIds.map((userId) => ({ reasonId: reason.general, userId, proficiency: 3, isPrimary: true })));
    for (const a of agents) await available_(a);
    for (let i = 0; i < 3; i++) await issue("general");

    const results = await Promise.all(agents.map((a) => callNext(a)));
    const got = results.map((r) => r.ticket?.id).filter(Boolean);
    expect(got).toHaveLength(3);
    expect(new Set(got).size).toBe(3);
    expect(results.filter((r) => !r.ticket).every((r) => r.reason === "empty")).toBe(true);
  });

  it("an agent with max 1 ticket cannot call a second one", async () => {
    await issue("general");
    await issue("general");
    await available_(khalid);
    expect((await callNext(khalid)).ticket).not.toBeNull();
    expect(await callNext(khalid)).toMatchObject({ ticket: null, reason: "at_capacity" });
  });

  it("rejects illegal transitions and actions on someone else's ticket", async () => {
    const t = await issue("general");
    await available_(khalid);
    await callNext(khalid);
    await expectCode(ticketAction(khalid, t.ticket.id, { action: "complete" }), "invalid_transition");
    await expectCode(ticketAction(noura, t.ticket.id, { action: "start" }), "forbidden", "not_your_ticket");
  });

  it("transfer keeps the original arrival time and hands the ticket to the chosen agent", async () => {
    const t = await issue("general");
    await available_(khalid);
    advanceClock(5);
    await callNext(khalid);
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    const moved = await ticketAction(khalid, t.ticket.id, {
      action: "transfer",
      toReasonId: reason.complaint,
      toAgentId: noura.auth.user.id,
      note: "يحتاج قسم الشكاوى",
    });
    expect(moved.ticket).toMatchObject({
      status: "WAITING",
      reasonId: reason.complaint,
      assignedAgentId: noura.auth.user.id,
      servingAgentId: null,
    });
    expect(moved.ticket.arrivedAt).toBe(t.ticket.arrivedAt);
    expect(moved.ticket.queuedAt).toBe(t.ticket.queuedAt);
    await available_(noura);
    expect((await callNext(noura)).ticket?.id).toBe(t.ticket.id);
  });

  it("hold returns the visitor to the same agent; accidental no-show can be undone", async () => {
    const t = await issue("general");
    await available_(khalid);
    await callNext(khalid);
    await ticketAction(khalid, t.ticket.id, { action: "no_show" });
    const undone = await ticketAction(khalid, t.ticket.id, { action: "undo" });
    expect(undone.ticket.status).toBe("CALLED");
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    const held = await ticketAction(khalid, t.ticket.id, { action: "hold" });
    expect(held.ticket).toMatchObject({ status: "ON_HOLD", assignedAgentId: khalid.auth.user.id });
    await ticketAction(khalid, t.ticket.id, { action: "resume" });
    expect((await callNext(khalid)).ticket?.id).toBe(t.ticket.id);

    await ticketAction(khalid, t.ticket.id, { action: "no_show" });
    advanceClock(3);
    await expectCode(ticketAction(khalid, t.ticket.id, { action: "undo" }), "conflict", "undo_expired");
  });

  it("push mode assigns immediately; changing the rule changes behaviour with no restart", async () => {
    await available_(khalid);
    await available_(noura);
    const pull = await issue("general");
    expect(pull.ticket.assignedAgentId).toBeNull();

    await setMode({ mode: "push", push: { strategies: ["least_waiting", "round_robin"] } });
    const p1 = await issue("general");
    const p2 = await issue("general");
    // The older pool ticket is assigned too once push is on; each agent holds one (max 1), the third waits.
    const rows = await db()
      .select()
      .from(tickets)
      .where(inArray(tickets.id, [pull.ticket.id, p1.ticket.id, p2.ticket.id]));
    const byId = new Map(rows.map((r) => [r.id, r.assignedAgentId]));
    expect([byId.get(pull.ticket.id), byId.get(p1.ticket.id)].sort()).toEqual([khalid.auth.user.id, noura.auth.user.id].sort());
    expect(byId.get(p2.ticket.id)).toBeNull();
    const evt = await db()
      .select()
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, p1.ticket.id), eq(ticketEvents.type, "ASSIGNED")));
    expect(evt).toHaveLength(1);
  });

  it("hybrid releases an ignored reservation after the timeout and raises an alert", async () => {
    await setMode({ mode: "hybrid", hybrid: { acceptTimeoutMinutes: 2 } });
    await available_(khalid);
    const t = await issue("general");
    expect(t.ticket.assignedAgentId).toBe(khalid.auth.user.id);
    advanceClock(1);
    await maintainBranch(branchId);
    expect((await db().select().from(tickets).where(eq(tickets.id, t.ticket.id)))[0].assignedAgentId).toBe(khalid.auth.user.id);
    advanceClock(2);
    await setAgentStatus(khalid, { status: "BUSY" });
    await maintainBranch(branchId);
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t.ticket.id));
    expect(row.assignedAgentId).toBeNull();
    const events = await db()
      .select()
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, t.ticket.id), eq(ticketEvents.type, "RELEASED")));
    expect(events[0].payload).toMatchObject({ cause: "accept_timeout" });
  });

  it("break releases reservations; returning makes the agent eligible again", async () => {
    await setMode({ mode: "push" });
    await available_(khalid);
    const t = await issue("general");
    expect(t.ticket.assignedAgentId).toBe(khalid.auth.user.id);
    await setAgentStatus(khalid, { status: "ON_BREAK" });
    expect((await db().select().from(tickets).where(eq(tickets.id, t.ticket.id)))[0].assignedAgentId).toBeNull();
    await available_(noura);
    expect((await db().select().from(tickets).where(eq(tickets.id, t.ticket.id)))[0].assignedAgentId).toBe(noura.auth.user.id);
  });

  it("no-show timeout closes or requeues according to policy", async () => {
    await setMode({ noShow: { timeoutMinutes: 3, action: "requeue_end" } });
    const t1 = await issue("general");
    advanceClock(0.1);
    await issue("general");
    await available_(khalid);
    expect((await callNext(khalid)).ticket?.id).toBe(t1.ticket.id);
    advanceClock(4);
    await maintainBranch(branchId);
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t1.ticket.id));
    expect(row.status).toBe("WAITING");
    expect(row.queuedAt.getTime()).toBeGreaterThan(row.arrivedAt.getTime());
    // It went to the end of the queue: the other ticket is called next.
    expect((await callNext(khalid)).ticket?.id).not.toBe(t1.ticket.id);
  });

  it("prayer pause blocks calling; tickets can still be issued", async () => {
    setClock(zonedToUtc("2026-09-29", "12:10", "Asia/Riyadh"));
    await issue("general");
    await available_(khalid);
    expect(await callNext(khalid)).toMatchObject({ ticket: null, reason: "paused" });
    const state = await queueState(reception, branchId);
    expect(state.paused?.name.ar).toBe("صلاة الظهر");
    await db().delete(pauseWindows);
    expect((await callNext(khalid)).ticket).not.toBeNull();
  });

  it("sticky: a returning visitor goes back to the agent who served them", async () => {
    await setMode({ sticky: { enabled: true } });
    // Noura is the primary for complaints, Khalid a backup; Khalid serves the first visit while Noura is away.
    await available_(khalid);
    const first = await issue("complaint", { fields: { phone: "0555000111" }, consent: true });
    expect((await callNext(khalid)).ticket?.id).toBe(first.ticket.id);
    await ticketAction(khalid, first.ticket.id, { action: "start" });
    await ticketAction(khalid, first.ticket.id, { action: "complete" });

    await available_(noura);
    const again = await issue("complaint", { fields: { phone: "٠٥٥٥ ٠٠٠ ١١١" }, consent: true });
    expect(again.ticket.visitor?.returning).toBe(true);
    expect(again.ticket.assignedAgentId).toBe(khalid.auth.user.id);
  });

  it("queue state lists today's tickets, ordering and agent statuses", async () => {
    await issue("general");
    await issue("contract", {
      priorityKey: "vip",
      fields: { name: "ضيف", phone: "0500000000", national_id_last4: "0000" },
      consent: true,
    });
    const state = await queueState(reception, branchId);
    expect(state.tickets).toHaveLength(2);
    expect(state.waitingOrder).toHaveLength(2);
    expect(state.agents.length).toBe(5);
    const byName = await queueState(reception, branchId, { q: "ضيف" });
    expect(byName.tickets).toHaveLength(1);
  });

  it("agents only serve reasons they are assigned to", async () => {
    await issue("account_manager", { fields: { company: "شركة", name: "سالم" }, consent: true });
    await available_(khalid);
    expect(await callNext(khalid)).toMatchObject({ ticket: null, reason: "empty" });
    const sara = await actorFor("sara@dor.local");
    await available_(sara);
    expect((await callNext(sara)).ticket).not.toBeNull();
    const [p] = await db()
      .select()
      .from(agentProfiles)
      .where(inArray(agentProfiles.userId, [sara.auth.user.id]));
    expect(p.status).toBe("AVAILABLE");
    void users;
  });
});
