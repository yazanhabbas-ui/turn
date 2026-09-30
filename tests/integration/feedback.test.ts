import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as feedbackRoute from "@/app/api/v1/public/tickets/[token]/feedback/route";
import { db, pool } from "@/db/client";
import { branches, csatResponses, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { feedbackLinkFor } from "@/server/feedback/links";
import { submitFeedback } from "@/server/feedback/service";
import { AppError } from "@/server/http/errors";
import { myProgress } from "@/server/profile/progress";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { publicTicketStatus } from "@/server/queue/views";
import { findAnomalies, listAlerts } from "@/server/reports/alerts";
import { buildExportDoc } from "@/server/reports/export-doc";
import { liveView } from "@/server/reports/live";
import { buildReport } from "@/server/reports/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("visitor feedback (database)", () => {
  let admin: Actor;
  let supervisor: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};
  const filters = { from: "2026-09-29", to: "2026-09-29" };

  /** A visit served by Khalid; returns the ticket's id and public token once completed. */
  async function visit(code = "general", opts: { complete?: boolean; phone?: string } = {}) {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      fields: code === "complaint" ? { phone: opts.phone ?? "0555000222" } : {},
      consent: code === "complaint",
      source: "reception",
    });
    advanceClock(2);
    await callNext(khalid, {});
    await ticketAction(khalid, t.ticket.id, { action: "start" });
    advanceClock(5);
    if (opts.complete !== false) await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "done" } as never);
    advanceClock(1);
    return { id: t.ticket.id, token: t.ticket.publicToken, display: t.ticket.displayNumber };
  }

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "09:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).where(eq(branches.code, "DAM-01"));
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
    await setAgentStatus(khalid, { status: "AVAILABLE" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("records an answer for a completed visit, once", async () => {
    const v = await visit();
    await submitFeedback(v.token, { score: 5, comment: "great", language: "en" });
    const [row] = await db().select().from(csatResponses).where(eq(csatResponses.ticketId, v.id));
    expect(row).toMatchObject({
      score: 5,
      comment: "great",
      channel: "status_page",
      language: "en",
      branchId,
      reasonId: reason.general,
    });
    expect(row.agentId).toBeTruthy();
    await expectCode(submitFeedback(v.token, { score: 1 }), "conflict");
    expect(await db().select().from(csatResponses)).toHaveLength(1);
  });

  it("rejects a visit that is not completed, an unknown token and out-of-range input", async () => {
    const v = await visit();
    const open = await visit("general", { complete: false });
    await expectCode(submitFeedback(open.token, { score: 4 }), "invalid_transition");
    await expectCode(submitFeedback("no-such-token", { score: 4 }), "not_found");
    for (const score of [0, 6, 2.5, "5"]) await expect(submitFeedback(v.token, { score })).rejects.toBeInstanceOf(ZodError);
    await expect(submitFeedback(v.token, { score: 4, nps: 11 })).rejects.toBeInstanceOf(ZodError);
    await expect(submitFeedback(v.token, { score: 4, comment: "x".repeat(501) })).rejects.toBeInstanceOf(ZodError);
    await submitFeedback(v.token, { score: 4, comment: "y".repeat(500) });
    expect(await db().select().from(csatResponses)).toHaveLength(1);
  });

  it("keeps a comment and an NPS answer only when the settings ask for them", async () => {
    const a = await visit();
    await submitFeedback(a.token, { score: 4, comment: "  nice  ", nps: 9 });
    let [row] = await db().select().from(csatResponses).where(eq(csatResponses.ticketId, a.id));
    expect(row).toMatchObject({ comment: "nice", nps: null });

    const feedback = { askNps: true, askComment: false };
    await updateSetting(admin, "feedback", feedback);
    const b = await visit();
    await submitFeedback(b.token, { score: 4, comment: "hidden", nps: 9 });
    [row] = await db().select().from(csatResponses).where(eq(csatResponses.ticketId, b.id));
    expect(row).toMatchObject({ comment: null, nps: 9 });
  });

  it("refuses answers when feedback is turned off, and hides the card", async () => {
    const v = await visit();
    expect((await publicTicketStatus(v.token))!.feedback).toMatchObject({ answered: false, style: "faces" });
    await updateSetting(admin, "feedback", { enabled: false });
    expect((await publicTicketStatus(v.token))!.feedback).toBeNull();
    await expectCode(submitFeedback(v.token, { score: 5 }), "not_found");
  });

  it("the status page carries the card only for completed visits, and knows when it is answered", async () => {
    const v = await visit();
    const open = await visit("general", { complete: false });
    expect((await publicTicketStatus(open.token))!.feedback).toBeNull();
    const before = (await publicTicketStatus(v.token))!;
    expect(before.feedback).toMatchObject({ askComment: true, askNps: false, answered: false, commentMax: 500 });
    expect(before.feedbackOnPage).toBe(true);
    await submitFeedback(v.token, { score: 3 });
    expect((await publicTicketStatus(v.token))!.feedback!.answered).toBe(true);
  });

  it("builds the feedback link from the public base URL and the visitor's language", async () => {
    const v = await visit();
    expect(feedbackLinkFor({ publicToken: v.token, language: "ar" })).toBe(`http://localhost:3000/t/${v.token}/feedback`);
    expect(feedbackLinkFor({ publicToken: v.token, language: "en" })).toBe(`http://localhost:3000/en/t/${v.token}/feedback`);
  });

  it("the public API needs no login, validates, and answers once", async () => {
    const v = await visit();
    const post = (token: string, body: unknown) =>
      feedbackRoute.POST(
        new NextRequest(new URL(`/api/v1/public/tickets/${token}/feedback`, "http://localhost:3000"), {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin: "http://localhost:3000",
            "content-type": "application/json",
            "x-dor-client-ip": "10.9.9.9",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ token }) },
      );
    expect((await post(v.token, { score: 9 })).status).toBe(400);
    expect((await post("nope", { score: 5 })).status).toBe(404);
    expect((await post(v.token, { score: 5 })).status).toBe(200);
    const again = await post(v.token, { score: 5 });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("conflict");
  });

  it("appears in the report overview and the export sections", async () => {
    const a = await visit("general");
    const b = await visit("complaint");
    await visit("general"); // completed, not rated
    await submitFeedback(a.token, { score: 5 });
    await submitFeedback(b.token, { score: 1, comment: "waited too long" });

    const report = await buildReport(admin, filters);
    const { csat } = report.data;
    expect(csat.summary).toMatchObject({ responses: 2, avg: 3, satisfiedPct: 50, eligible: 3, responseRatePct: 66.7 });
    expect(csat.summary.distribution.find((d) => d.score === 1)!.count).toBe(1);
    expect(csat.byReason).toHaveLength(2);
    expect(csat.byAgent[0]).toMatchObject({ responses: 2, avg: 3 });
    expect(csat.byDay).toEqual([{ date: "2026-09-29", responses: 2, avg: 3 }]);
    // The visitor is named (reception recorded a phone) but the number is masked for a role without visitor privacy.
    expect(csat.lowComments).toHaveLength(1);
    expect(csat.lowComments[0]).toMatchObject({ score: 1, comment: "waited too long", displayNumber: b.display });
    expect(csat.lowComments[0].phoneMasked).toBe("••••222");
    const agent = report.data.agents.find((x) => x.csatResponses === 2);
    expect(agent?.csatAvg).toBe(3);

    // Filters narrow it: one reason.
    const only = await buildReport(admin, { ...filters, reasonId: reason.complaint });
    expect(only.data.csat.summary).toMatchObject({ responses: 1, avg: 1 });

    const doc = buildExportDoc(report, "en", ["csatSummary", "csatDistribution", "csatByDay", "csatBreakdown", "csatComments"]);
    expect(doc.tables.map((t) => t.id)).toEqual([
      "csatSummary",
      "csatDistribution",
      "csatByDay",
      "csatBreakdown",
      "csatComments",
    ]);
    const rows = (id: string) => doc.tables.find((t) => t.id === id)!.rows;
    expect(rows("csatSummary")[0]).toEqual(["Average score (1-5)", 3]);
    expect(rows("csatDistribution")).toHaveLength(5);
    expect(rows("csatComments")[0][2]).toBe("waited too long");
    expect(rows("csatBreakdown").length).toBeGreaterThanOrEqual(3);
    // The default full report includes the satisfaction tables once somebody answered.
    expect(buildExportDoc(report, "ar").tables.some((t) => t.id === "csatSummary")).toBe(true);
    // A chosen section is emitted even when empty.
    const none = await buildReport(admin, { from: "2026-09-28", to: "2026-09-28" });
    expect(buildExportDoc(none, "en", ["csatComments"]).tables[0].rows).toEqual([]);
    expect(buildExportDoc(none, "en").tables.some((t) => t.id === "csatSummary")).toBe(false);
  });

  it("raises an alert for a low score, and a low average over the window", async () => {
    const good = await visit();
    await submitFeedback(good.token, { score: 5 });
    expect((await findAnomalies(branchId)).filter((a) => a.type === "low_score")).toEqual([]);

    const bad = await visit();
    await submitFeedback(bad.token, { score: 2, comment: "private words" });
    const list = await listAlerts(supervisor, { openOnly: true });
    const alert = list.find((a) => a.type === "low_score");
    expect(alert).toMatchObject({ branchId, severity: "warning" });
    expect(alert!.payload).toMatchObject({ displayNumber: bad.display, score: 2, hasComment: true });
    // The comment itself never travels with the alert.
    expect(JSON.stringify(alert!.payload)).not.toContain("private words");

    // Rolling average: needs a limit and enough answers.
    expect((await findAnomalies(branchId)).some((a) => a.type === "low_satisfaction")).toBe(false);
    await updateSetting(admin, "alerts", { lowSatisfactionBelow: 4.5, lowSatisfactionMinResponses: 2 });
    const found = (await findAnomalies(branchId)).find((a) => a.type === "low_satisfaction");
    expect(found?.payload).toMatchObject({ avg: 3.5, responses: 2, limit: 4.5 });
    await updateSetting(admin, "alerts", { lowSatisfactionBelow: 4.5, lowSatisfactionMinResponses: 3 });
    expect((await findAnomalies(branchId)).some((a) => a.type === "low_satisfaction")).toBe(false);

    // Switching the per-response alert off silences it.
    await updateSetting(admin, "alerts", { lowScoreAlerts: false });
    expect((await findAnomalies(branchId)).some((a) => a.type === "low_score")).toBe(false);
  });

  it("shows today's satisfaction on the wallboard unless the tile is off", async () => {
    const a = await visit();
    const b = await visit();
    await submitFeedback(a.token, { score: 5 });
    await submitFeedback(b.token, { score: 4 });
    const live = await liveView(supervisor, branchId);
    expect(live.tiles.csat).toMatchObject({ avg: 4.5, responses: 2, satisfiedPct: 100 });
    await updateSetting(admin, "wallboard", { showCsat: false });
    expect((await liveView(supervisor, branchId)).tiles.csat).toBeNull();
  });

  it("gives the agent their own average, the branch average and recent comments", async () => {
    const a = await visit();
    const b = await visit();
    await submitFeedback(a.token, { score: 5, comment: "kind agent" });
    await submitFeedback(b.token, { score: 3 });
    const p = await myProgress(khalid, "week");
    const csat = p.agent!.csat!;
    expect(csat.periods.day.current).toMatchObject({ avg: 4, responses: 2, satisfiedPct: 50 });
    expect(csat.periods.day.branchAvg).toBe(4);
    expect(csat.recent.map((r) => r.comment)).toEqual(["kind agent"]);
    expect(csat.trend.at(-1)).toMatchObject({ date: "2026-09-29", avg: 4, responses: 2 });
    // Turned off: no block at all.
    await updateSetting(admin, "feedback", { enabled: false });
    expect((await myProgress(khalid, "week")).agent!.csat).toBeNull();
  });

  it("a city admin sees only the feedback of their own branches", async () => {
    const v = await visit();
    await submitFeedback(v.token, { score: 5 });
    const damascus = await actorFor("damascus.admin@dor.local");
    const aleppo = await actorFor("aleppo.admin@dor.local");
    expect((await buildReport(damascus, filters)).data.csat.summary.responses).toBe(1);
    expect((await buildReport(aleppo, filters)).data.csat.summary.responses).toBe(0);
    await expectCode(buildReport(aleppo, { ...filters, branchId }), "forbidden");
  });

  it("branches can word the questions differently from the organization default", async () => {
    await updateSetting(admin, "feedback", { thanks: { ar: "شكراً", en: "Thanks" } });
    await updateSetting(admin, "feedback", { thanks: { ar: "شكراً من فرعنا", en: "Thanks from us" } }, branchId);
    const v = await visit();
    expect((await publicTicketStatus(v.token))!.feedback!.thanks.en).toBe("Thanks from us");
  });
});
