import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, csatResponses, desks, tickets, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { listNotificationLog, providersOverview, resendNotification } from "@/server/admin/notifications";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { submitFeedback } from "@/server/feedback/service";
import { AppError } from "@/server/http/errors";
import { myReport, myReportDetails } from "@/server/profile/report";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { liveView } from "@/server/reports/live";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("negative ratings (D63)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let reception: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

  /** A visit served and completed by an agent; the visitor (with a phone and a name) answers with `score`. */
  async function rated(score: number, who: Actor = khalid, comment?: string) {
    // Only the serving agent is available, so the ticket goes to them.
    await setAgentStatus(who === khalid ? noura : khalid, { status: "OFFLINE" });
    await setAgentStatus(who, { status: "AVAILABLE" });
    const t = await issueTicket(reception, {
      branchId,
      reasonId: reason.complaint,
      language: "ar",
      fields: { phone: "0555123987", name: "Secret Visitor" },
      consent: true,
      source: "reception",
    });
    advanceClock(2);
    await callNext(who, {});
    await ticketAction(who, t.ticket.id, { action: "start" });
    advanceClock(3);
    await ticketAction(who, t.ticket.id, { action: "complete", outcome: "done" } as never);
    await submitFeedback(t.ticket.publicToken, { score, comment });
    advanceClock(1);
    return { id: t.ticket.id, display: t.ticket.displayNumber };
  }
  const panel = async (actor: Actor = supervisor) => (await liveView(actor, branchId)).negativeRatings;

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "09:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).where(eq(branches.code, "DAM-01"));
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
    await setAgentStatus(khalid, { status: "AVAILABLE" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("lists only ratings up to the threshold, with ticket, desk and agent, newest first", async () => {
    const low = await rated(1, khalid, "slow service");
    await rated(5);
    const two = await rated(2);
    await rated(3);
    const p = (await panel())!;
    expect(p.threshold).toBe(2);
    expect(p.total).toBe(2);
    expect(p.items.map((i) => i.displayNumber)).toEqual([two.display, low.display]);
    const [row] = await db().select({ deskId: tickets.deskId }).from(tickets).where(eq(tickets.id, two.id));
    const [desk] = await db().select().from(desks).where(eq(desks.id, row.deskId!));
    expect(p.items[0]).toMatchObject({ score: 2, desk: { number: desk.number } });
    expect(p.items[0].agent!.name.ar).toBeTruthy();
    expect(p.items[0].reason).toBeTruthy();
  });

  it("follows the configured threshold", async () => {
    for (const s of [1, 2, 3, 4]) await rated(s);
    await updateSetting(admin, "feedback", { lowScoreThreshold: 1 });
    expect((await panel())!.items.map((i) => i.score)).toEqual([1]);
    await updateSetting(admin, "feedback", { lowScoreThreshold: 3 });
    expect((await panel())!.items.map((i) => i.score)).toEqual([3, 2, 1]);
    // A branch can set its own.
    await updateSetting(admin, "feedback", { lowScoreThreshold: 4 }, branchId);
    expect((await panel())!.total).toBe(4);
  });

  it("honours the look-back window and the count limit", async () => {
    await rated(1);
    advanceClock(25 * 60);
    await rated(2);
    await rated(1);
    expect((await panel())!.total).toBe(2);
    await updateSetting(admin, "wallboard", { negativeRatingsHours: 48 });
    expect((await panel())!.total).toBe(3);
    await updateSetting(admin, "wallboard", { negativeRatingsHours: 48, negativeRatingsCount: 1 });
    const p = (await panel())!;
    expect(p.items).toHaveLength(1);
    expect(p.total).toBe(3);
  });

  it("shows a comment only when the setting is on, and never the visitor name or phone", async () => {
    await rated(1, khalid, "the waiting was too long and nobody told us anything about what was going on today");
    expect((await panel())!.items[0].comment).toBeNull();
    await updateSetting(admin, "wallboard", { showNegativeComment: true });
    expect((await panel())!.items[0].comment).toContain("the waiting was too long");
    const json = JSON.stringify(await liveView(supervisor, branchId));
    expect(json).not.toContain("555123987");
    expect(json).not.toContain("Secret Visitor");
  });

  it("is off when the panel is switched off or visitor feedback is disabled", async () => {
    await rated(1);
    await updateSetting(admin, "wallboard", { showNegativeRatings: false });
    expect(await panel()).toBeNull();
    await updateSetting(admin, "wallboard", { showNegativeRatings: true });
    await updateSetting(admin, "feedback", { enabled: false });
    expect(await panel()).toBeNull();
  });

  it("only shows a branch's own ratings to the people who can see that branch", async () => {
    await rated(1);
    const aleppo = await actorFor("aleppo.admin@dor.local");
    const damascus = await actorFor("damascus.admin@dor.local");
    await expectCode(liveView(aleppo, branchId), "forbidden");
    expect((await liveView(damascus, branchId)).negativeRatings!.total).toBe(1);
    expect((await liveView(aleppo)).negativeRatings!.total).toBe(0);
  });

  it("gives the agent a rating summary of their own tickets only, and the negative filter", async () => {
    const mine = await rated(1, khalid, "please be quicker");
    await rated(5, khalid);
    await rated(1, noura, "not my ticket");
    const r = await myReport(khalid, { period: "day" });
    expect(r.csat).toMatchObject({ responses: 2, avg: 3, threshold: 2, negativeCount: 1, negativePct: 50, satisfiedPct: 50 });
    expect(r.csat!.branchAvg).toBe(2.33);
    expect(r.csat!.comments.map((c) => c.comment)).toEqual(["please be quicker"]);
    expect(r.csat!.comments[0].displayNumber).toBe(mine.display);

    const all = await myReportDetails(khalid, { period: "day" }, { limit: 25 });
    expect(all.items).toHaveLength(2);
    expect(all.items.filter((i) => i.negative).map((i) => i.displayNumber)).toEqual([mine.display]);
    const only = await myReportDetails(khalid, { period: "day" }, { limit: 25, negativeOnly: true });
    expect(only.items.map((i) => i.displayNumber)).toEqual([mine.display]);

    await updateSetting(admin, "feedback", { lowScoreThreshold: 1 });
    expect((await myReport(khalid, { period: "day" })).csat!.threshold).toBe(1);
    // Feedback off: nothing about ratings.
    await updateSetting(admin, "feedback", { enabled: false });
    expect((await myReport(khalid, { period: "day" })).csat).toBeNull();
    const off = await myReportDetails(khalid, { period: "day" }, { limit: 25, negativeOnly: true });
    expect(off.items.every((i) => i.score === null && !i.negative)).toBe(true);
  });

  it("shows an empty rating block, not nothing, when nobody has rated yet", async () => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: reason.general,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    advanceClock(2);
    await callNext(khalid, {});
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "done" } as never);
    const r = await myReport(khalid, { period: "day" });
    expect(r.csat).toMatchObject({ responses: 0, avg: null, negativeCount: 0, negativePct: null });
    expect(await db().select().from(csatResponses)).toHaveLength(0);
  });

  it("keeps the notifications tools from supervisors, receptionists and agents, and open for administrators", async () => {
    for (const who of [supervisor, reception, khalid]) {
      expect(() => providersOverview(who)).toThrowError(AppError);
      await expectCode(listNotificationLog(who, { limit: 10 }), "forbidden");
      await expectCode(resendNotification(who, "00000000-0000-0000-0000-000000000001"), "forbidden");
    }
    expect(providersOverview(admin).providers).toBeTruthy();
    const damascus = await actorFor("damascus.admin@dor.local");
    expect(providersOverview(damascus).providers).toBeTruthy();
    expect((await listNotificationLog(damascus, { limit: 10 })).items).toEqual([]);
  });
});
