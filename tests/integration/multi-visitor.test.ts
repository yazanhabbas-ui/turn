import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { agentProfiles, branches, users, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { liveView } from "@/server/reports/live";
import { agentWorkspace } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("several visitors at once (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let supervisor: Actor;
  let branchId: string;
  let generalId: string;

  const issue = async () => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: generalId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    advanceClock(0.1); // tickets issued in the same millisecond have no defined order
    return t.ticket.id;
  };

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    [{ id: generalId }] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "general"));
    await setAgentStatus(khalid, { status: "AVAILABLE" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("serves one visitor at a time unless the organization allows more", async () => {
    await issue();
    await issue();
    expect((await callNext(khalid, {})).ticket).not.toBeNull();
    expect(await callNext(khalid, {})).toMatchObject({ ticket: null, reason: "at_capacity" });
    const ws = await agentWorkspace(khalid);
    expect(ws.profile.maxConcurrent).toBe(1);
    expect(ws.active).toHaveLength(1);
  });

  it("with multiple visitors enabled an agent takes the organization default, or their own limit", async () => {
    await updateSetting(admin, "agentWork", { multipleVisitors: true, visitorsPerAgent: 2 });
    const a = await issue();
    const b = await issue();
    await issue();
    const first = await callNext(khalid, {});
    const second = await callNext(khalid, {});
    expect([first.ticket?.id, second.ticket?.id]).toEqual([a, b]);
    expect(await callNext(khalid, {})).toMatchObject({ ticket: null, reason: "at_capacity" });

    const ws = await agentWorkspace(khalid);
    expect(ws.profile.maxConcurrent).toBe(2);
    expect(ws.active.map((t) => t.id)).toEqual([a, b]);

    // Finishing one frees a place; the two visitors are independent tickets.
    await ticketAction(khalid, a, { action: "start" });
    await ticketAction(khalid, a, { action: "complete", outcome: "done" } as never);
    expect((await callNext(khalid, {})).ticket).not.toBeNull();

    // A personal limit beats the default.
    const [u] = await db().select({ id: users.id }).from(users).where(eq(users.email, "khalid@dor.local"));
    await db().update(agentProfiles).set({ maxConcurrent: 3 }).where(eq(agentProfiles.userId, u.id));
    await issue();
    expect((await callNext(khalid, {})).ticket).not.toBeNull();
    expect((await agentWorkspace(khalid)).profile.maxConcurrent).toBe(3);
  });

  it("turning the feature off caps everyone at one again, whatever their personal limit", async () => {
    await updateSetting(admin, "agentWork", { multipleVisitors: false, visitorsPerAgent: 5 });
    const [u] = await db().select({ id: users.id }).from(users).where(eq(users.email, "khalid@dor.local"));
    await db().update(agentProfiles).set({ maxConcurrent: 4 }).where(eq(agentProfiles.userId, u.id));
    await issue();
    await issue();
    await callNext(khalid, {});
    expect(await callNext(khalid, {})).toMatchObject({ ticket: null, reason: "at_capacity" });
  });

  it("the wallboard lists every visitor an agent has", async () => {
    await updateSetting(admin, "agentWork", { multipleVisitors: true, visitorsPerAgent: 2 });
    await issue();
    await issue();
    await callNext(khalid, {});
    await callNext(khalid, {});
    const live = await liveView(supervisor);
    const desk = live.desks.find((d) => d.agent && d.tickets.length > 0);
    expect(desk?.tickets).toHaveLength(2);
    expect(live.wallboard).toMatchObject({ theme: "dark", showLogo: true, textScale: 100 });
    expect(live.branding.primaryColor).toMatch(/^#/);
  });
});
