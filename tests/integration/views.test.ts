import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { appointments, branches, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { agentWorkspace, lookupAppointment, publicTicketStatus, queueState, receptionContext } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("queue views (database)", () => {
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

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

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Riyadh"));
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

  it("reception context lists reasons with waiting counts and permissions", async () => {
    await issue("general");
    const ctx = await receptionContext(reception, null);
    expect(ctx.branch.id).toBe(branchId);
    const general = ctx.reasons.find((r) => r.code === "general")!;
    expect(general.waiting).toBe(1);
    expect(ctx.modes[reason.general]).toBe("pull");
    expect(ctx.priorities.map((p) => p.key)).toContain("vip");
    expect(ctx.canCancel).toBe(true);
    expect(ctx.canReassign).toBe(false);
    await expect(receptionContext(khalid, null)).rejects.toBeInstanceOf(AppError);
  });

  it("agent workspace shows the current ticket, queues served and reference data", async () => {
    const t = await issue("general");
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    await callNext(khalid);
    const ws = await agentWorkspace(khalid);
    expect(ws.profile.status).toBe("AVAILABLE");
    expect(ws.active.map((a) => a.id)).toEqual([t.ticket.id]);
    expect(ws.queues.map((q) => q.reasonId)).toContain(reason.general);
    expect(ws.desks.length).toBe(6);
    expect(ws.breakTypes.length).toBeGreaterThan(0);
    expect(ws.agents.some((a) => a.id === khalid.auth.user.id)).toBe(false);
  });

  it("agents see personal data only for their own tickets", async () => {
    const mine = await issue("complaint", { fields: { phone: "0501111111", name: "سلمان" }, consent: true });
    advanceClock(0.1);
    await issue("complaint", { fields: { phone: "0502222222", name: "فيصل" }, consent: true });
    await setAgentStatus(noura, { status: "AVAILABLE" });
    await callNext(noura);
    const agentView = await queueState(noura, branchId);
    const own = agentView.tickets.find((t) => t.id === mine.ticket.id)!;
    const other = agentView.tickets.find((t) => t.id !== mine.ticket.id)!;
    expect(own.visitor?.name).toBe("سلمان");
    expect(other.visitor).toBeNull();
    const receptionView = await queueState(reception, branchId);
    expect(receptionView.tickets.every((t) => t.visitor?.name)).toBe(true);
    expect(Object.keys(receptionView.positions)).toHaveLength(1);
  });

  it("looks up appointments and checks them in with the appointment's reason", async () => {
    const [appt] = await db()
      .insert(appointments)
      .values({
        organizationId: reception.auth.user.organizationId,
        branchId,
        reasonId: reason.account_manager,
        code: "K7Q2PM",
        scheduledAt: new Date(zonedToUtc("2026-09-29", "10:30", "Asia/Riyadh")),
      })
      .returning();
    const found = await lookupAppointment(reception, branchId, " k7q2pm ");
    expect(found.id).toBe(appt.id);
    const t = await issue("account_manager", {
      appointmentId: appt.id,
      fields: { company: "شركة الأمل", name: "سالم" },
      consent: true,
      source: "appointment",
    });
    expect(t.ticket.appointmentId).toBe(appt.id);
    const [after] = await db().select().from(appointments).where(eq(appointments.id, appt.id));
    expect(after.status).toBe("CHECKED_IN");
    await expect(lookupAppointment(reception, branchId, "NOPE00")).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "not_found",
    );
  });

  it("public status shows position while waiting and the desk once called, without personal data", async () => {
    await issue("general");
    advanceClock(0.1);
    const t = await issue("general", {});
    let status = await publicTicketStatus(t.ticket.publicToken);
    expect(status).toMatchObject({ displayNumber: "A-002", status: "WAITING" });
    expect(status!.position?.ahead).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(status)).not.toContain("visitor");
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    await callNext(khalid);
    await ticketAction(khalid, (await queueState(khalid, branchId)).tickets.find((x) => x.status === "CALLED")!.id, {
      action: "no_show",
    });
    await callNext(khalid);
    status = await publicTicketStatus(t.ticket.publicToken);
    expect(status?.status).toBe("CALLED");
    expect(status?.desk?.number).toBeTruthy();
    expect(await publicTicketStatus("nope")).toBeNull();
  });
});
