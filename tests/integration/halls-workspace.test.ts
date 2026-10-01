import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { createHall } from "@/server/halls/admin";
import { callGroup, sessionAction } from "@/server/halls/service";
import { issueTicket, setAgentStatus } from "@/server/queue/tickets";
import { agentWorkspace } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("agent workspace: hall console (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  let generalId: string;
  let hallId: string;

  const issue = async () => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: generalId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    advanceClock(0.1);
    return t.ticket.id;
  };

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    [{ id: generalId }] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "general"));
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  async function enableHalls(minGroup = 1) {
    await db().update(visitReasons).set({ delivery: "hall" }).where(eq(visitReasons.id, generalId));
    await updateSetting(admin, "halls", { enabled: true, minGroup, maxGroup: 0, allowTopUp: true, autoStartWhenAllEntered: true });
    ({ id: hallId } = await createHall(admin, branchId, {
      number: "H1",
      name: { ar: "قاعة الاجتماعات", en: "Meeting hall" },
      capacity: 4,
      reasonIds: [],
      sortOrder: 0,
    }));
  }

  it("leaves a desk agent's workspace unchanged while halls are off", async () => {
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    await issue();
    const ws = await agentWorkspace(khalid);
    expect(ws.hall).toBeNull();
    expect(ws.profile.currentHallId).toBeNull();
    expect(ws.active).toEqual([]);
  });

  it("shows the hall console through the whole lifecycle and keeps hall visitors out of `active`", async () => {
    await enableHalls();
    const [a, b, c] = [await issue(), await issue(), await issue()];

    // Before calling: the hall, who waits, how many can be called.
    await setAgentStatus(khalid, { status: "AVAILABLE", hallId });
    let ws = await agentWorkspace(khalid);
    expect(ws.profile.currentHallId).toBe(hallId);
    expect(ws.hall).not.toBeNull();
    expect(ws.hall!.hall).toMatchObject({ id: hallId, number: "H1", capacity: 4 });
    expect(ws.hall!.halls.map((h) => h.id)).toEqual([hallId]);
    expect(ws.hall!.waiting).toBe(3);
    expect(ws.hall!.callable).toBe(3);
    expect(ws.hall!.maxCall).toBe(4);
    expect(ws.hall!.session).toBeNull();

    // Called: a session with CALLED visitors; nobody is at a desk.
    const called = await callGroup(khalid, { size: 2 });
    expect(called.created).toBe(true);
    ws = await agentWorkspace(khalid);
    expect(ws.active).toEqual([]);
    expect(ws.hall!.session).toMatchObject({ status: "OPEN", occupied: 2, capacity: 4 });
    expect(ws.hall!.session!.tickets.map((m) => m.status)).toEqual(["CALLED", "CALLED"]);
    expect(ws.hall!.session!.tickets.map((m) => m.ticket.id)).toEqual([a, b]);
    expect(ws.hall!.waiting).toBe(1);
    expect(ws.hall!.maxCall).toBe(2);
    expect(ws.hall!.callable).toBe(1);
    expect(ws.visitHistory).toBeDefined();

    // One enters, the other is still at the door.
    await sessionAction(khalid, called.session!.id, { action: "enter", ticketIds: [a] });
    ws = await agentWorkspace(khalid);
    expect(ws.hall!.session!.tickets.map((m) => m.status)).toEqual(["ENTERED", "CALLED"]);
    expect(ws.active).toEqual([]);

    await sessionAction(khalid, called.session!.id, { action: "enter" });
    ws = await agentWorkspace(khalid);
    expect(ws.hall!.session!.tickets.map((m) => m.status)).toEqual(["ENTERED", "ENTERED"]);
    expect(ws.hall!.session!.status).toBe("IN_SESSION"); // autoStartWhenAllEntered

    // Closed: the session is gone from the console, the third visitor still waits.
    await sessionAction(khalid, called.session!.id, { action: "close", outcome: "resolved" });
    ws = await agentWorkspace(khalid);
    expect(ws.hall!.session).toBeNull();
    expect(ws.hall!.waiting).toBe(1);
    expect(ws.active).toEqual([]);
    expect(c).toBeTruthy();
  });

  it("explains a minimum group and returns a cancelled session to the queue", async () => {
    await enableHalls(2);
    await issue();
    await setAgentStatus(khalid, { status: "AVAILABLE", hallId });
    let ws = await agentWorkspace(khalid);
    expect(ws.hall).toMatchObject({ waiting: 1, callable: 0 });
    expect(ws.hall!.settings.minGroup).toBe(2);
    expect(await callGroup(khalid, {})).toMatchObject({ session: null, reason: "below_min" });

    await issue();
    const r = await callGroup(khalid, {});
    expect(r.session!.tickets).toHaveLength(2);
    // A second press is safe: the same session comes back.
    const again = await callGroup(khalid, {});
    expect(again.created).toBe(false);
    expect(again.session!.id).toBe(r.session!.id);

    await sessionAction(khalid, r.session!.id, { action: "cancel" });
    ws = await agentWorkspace(khalid);
    expect(ws.hall!.session).toBeNull();
    expect(ws.hall!.waiting).toBe(2);
  });
});
