import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import {
  auditLogs,
  branches,
  csatResponses,
  displays,
  invites,
  notificationsLog,
  passwordResetTokens,
  privacyRequests,
  roles,
  sessions,
  tickets,
  userAvatars,
  users,
  visitReasons,
  visitors,
} from "@/db/schema";
import { DAY_MS } from "@/domain/privacy/retention";
import type { Actor } from "@/server/admin/actor";
import { updateSetting } from "@/server/admin/settings-admin";
import { setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { retentionOverview, runRetentionNow } from "@/server/privacy/admin";
import { lastRetentionRun, runDueRetention, runRetention } from "@/server/privacy/retention";
import {
  eraseSubject,
  erasureInput,
  exportSubject,
  findSubjects,
  listRequests,
  subjectDetails,
  subjectRef,
} from "@/server/privacy/subjects";
import { anonymizeUser } from "@/server/privacy/users";
import { setUserActive } from "@/server/admin/users";
import { issueTicket } from "@/server/queue/tickets";
import { buildReport } from "@/server/reports/service";
import { defaultSetting } from "@/server/settings/registry";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

const NOW = Date.parse("2026-09-29T07:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY_MS);

describe.runIf(available)("data retention and privacy requests (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let damascusAdmin: Actor;
  let aleppoAdmin: Actor;
  let orgId: string;
  let branchId: string;
  let otherBranchId: string;
  let complaint: string;
  let phoneN = 0;

  const setPrivacy = (patch: Record<string, unknown>) =>
    updateSetting(admin, "privacy", { ...defaultSetting("privacy"), ...patch });

  /** A finished visit by a named visitor, `days` ago, with free text, a feedback comment and a sent message. */
  async function visit(name: string, days: number, opts: { branch?: string } = {}) {
    const phone = `094400${String(++phoneN).padStart(4, "0")}`;
    const r = await issueTicket(reception, {
      branchId,
      reasonId: complaint,
      language: "ar",
      fields: { name, phone },
      consent: true,
      source: "reception",
    });
    const [t] = await db().select().from(tickets).where(eq(tickets.id, r.ticket.id));
    await db()
      .update(tickets)
      .set({
        status: "COMPLETED",
        arrivedAt: ago(days),
        finishedAt: ago(days),
        notes: `note of ${name}`,
        intake: { name, extra: "private" },
        ...(opts.branch ? { branchId: opts.branch } : {}),
      })
      .where(eq(tickets.id, t.id));
    await db()
      .update(visitors)
      .set({ lastVisitAt: ago(days) })
      .where(eq(visitors.id, t.visitorId!));
    await db()
      .insert(csatResponses)
      .values({
        organizationId: orgId,
        branchId: opts.branch ?? branchId,
        ticketId: t.id,
        score: 4,
        comment: `comment of ${name}`,
        channel: "link",
        at: ago(days),
      });
    // Replace the message the issue itself queued with a known one.
    await db().delete(notificationsLog).where(eq(notificationsLog.ticketId, t.id));
    await db()
      .insert(notificationsLog)
      .values({
        organizationId: orgId,
        branchId: opts.branch ?? branchId,
        ticketId: t.id,
        channel: "whatsapp",
        provider: "mock",
        event: "ticket_issued",
        recipientMasked: "+96394****12",
        status: "sent",
        payload: { number: t.displayNumber, name },
        createdAt: ago(days),
      });
    return { ticketId: t.id, visitorId: t.visitorId!, phone };
  }

  const visitor = async (id: string) => (await db().select().from(visitors).where(eq(visitors.id, id)))[0];
  const ticket = async (id: string) => (await db().select().from(tickets).where(eq(tickets.id, id)))[0];
  const comment = async (ticketId: string) =>
    (await db().select().from(csatResponses).where(eq(csatResponses.ticketId, ticketId)))[0].comment;
  const notif = async (ticketId: string) =>
    (await db().select().from(notificationsLog).where(eq(notificationsLog.ticketId, ticketId)))[0];

  beforeEach(async () => {
    process.env.MESSAGING_MOCK = "true";
    setClock(NOW);
    phoneN = 0;
    orgId = await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    damascusAdmin = await actorFor("damascus.admin@dor.local");
    aleppoAdmin = await actorFor("aleppo.admin@dor.local");
    const bs = await db().select({ id: branches.id, code: branches.code }).from(branches).orderBy(branches.code);
    branchId = bs.find((b) => b.code === "DAM-01")!.id;
    otherBranchId = bs.find((b) => b.code === "ALP-01")!.id;
    [{ id: complaint }] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "complaint"));
  });
  afterAll(async () => {
    delete process.env.MESSAGING_MOCK;
    setClock(null);
    await pool().end();
  });

  describe("retention job", () => {
    it("anonymises only visitors older than the period, removes phone and hash, keeps aggregates", async () => {
      const old = await visit("Old Visitor", 400);
      const fresh = await visit("Fresh Visitor", 10);
      const windows = [
        { from: "2025-08-20", to: "2025-09-10" },
        { from: "2026-07-01", to: "2026-09-30" },
      ];
      const reports = async () => JSON.stringify(await Promise.all(windows.map((w) => buildReport(admin, w))));
      const before = await reports();
      const ticketsBefore = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(tickets);

      const s = await runRetention(orgId, { trigger: "manual" });
      expect(s.counts.visitors).toBe(1);

      const o = await visitor(old.visitorId);
      expect(o).toMatchObject({ name: null, nameSearch: null, nameTranslit: null, phone: null, phoneHash: null, company: null });
      expect(o.anonymizedAt).not.toBeNull();
      const f = await visitor(fresh.visitorId);
      expect(f).toMatchObject({ name: "Fresh Visitor", anonymizedAt: null });
      expect(f.phone).not.toBeNull();
      expect(f.phoneHash).not.toBeNull();

      // Tickets and report totals do not change.
      expect(
        await db()
          .select({ n: sql<number>`count(*)::int` })
          .from(tickets),
      ).toEqual(ticketsBefore);
      expect(await reports()).toBe(before);
      // The audit entry of the run carries counts only.
      const last = await lastRetentionRun(orgId);
      expect(last?.counts.visitors).toBe(1);
      expect(JSON.stringify(last)).not.toContain("Old Visitor");
    });

    it("clears ticket text, comments and notification details of old rows only", async () => {
      const old = await visit("Old", 400);
      const mid = await visit("Mid", 100); // comments 365 d, notifications 90 d
      const fresh = await visit("Fresh", 5);
      await db()
        .insert(notificationsLog)
        .values({
          organizationId: orgId,
          branchId,
          ticketId: fresh.ticketId,
          channel: "sms",
          provider: "mock",
          event: "your_turn",
          recipientMasked: "+96394****99",
          status: "queued",
          payload: { channels: ["sms"] },
          createdAt: ago(200),
        });

      const s = await runRetention(orgId);
      expect(s.counts).toMatchObject({ tickets: 1, comments: 1, notifications: 2 });

      expect(await ticket(old.ticketId)).toMatchObject({ notes: null, intake: {}, status: "COMPLETED" });
      expect((await ticket(mid.ticketId)).notes).toBe("note of Mid");
      expect(await comment(old.ticketId)).toBeNull();
      expect(await comment(mid.ticketId)).toBe("comment of Mid");
      const n = await notif(old.ticketId);
      expect(n).toMatchObject({ recipientMasked: null, payload: {}, status: "sent" });
      const m = await notif(mid.ticketId); // 100 days > 90
      expect(m.recipientMasked).toBeNull();
      // The score is kept, and a message still waiting keeps what the sender needs.
      expect((await db().select().from(csatResponses).where(eq(csatResponses.ticketId, old.ticketId)))[0].score).toBe(4);
      const queued = await db()
        .select()
        .from(notificationsLog)
        .where(and(eq(notificationsLog.ticketId, fresh.ticketId), eq(notificationsLog.status, "queued")));
      expect(queued[0].payload).toEqual({ channels: ["sms"] });
    });

    it("0 keeps everything of that kind", async () => {
      const old = await visit("Old", 900);
      await setPrivacy({
        retentionDays: 0,
        ticketDataDays: 0,
        commentDays: 0,
        notificationDays: 0,
        auditDays: 0,
        credentialDays: 0,
      });
      const s = await runRetention(orgId);
      expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(0);
      expect(await visitor(old.visitorId)).toMatchObject({ name: "Old", anonymizedAt: null });
      expect((await ticket(old.ticketId)).notes).toBe("note of Old");
      expect(await comment(old.ticketId)).toBe("comment of Old");
    });

    it("dry run counts exactly what the real run then changes, and changes nothing itself", async () => {
      for (let i = 0; i < 3; i++) await visit(`Old ${i}`, 500);
      await visit("Fresh", 1);
      await db()
        .insert(sessions)
        .values({ id: "dead-session", userId: (await actorFor("khalid@dor.local")).auth.user.id, expiresAt: ago(60) });

      const preview = await runRetention(orgId, { dryRun: true });
      expect(preview.dryRun).toBe(true);
      expect(preview.counts).toMatchObject({ visitors: 3, tickets: 3, comments: 3, notifications: 3, sessions: 1 });
      expect(await lastRetentionRun(orgId)).toBeNull(); // a preview leaves no trace
      expect(
        (
          await db()
            .select()
            .from(visitors)
            .where(sql`anonymized_at is not null`)
        ).length,
      ).toBe(0);
      expect((await db().select().from(sessions).where(eq(sessions.id, "dead-session"))).length).toBe(1);

      const real = await runRetention(orgId);
      expect(real.counts).toEqual(preview.counts);
    });

    it("works in batches and is idempotent", async () => {
      for (let i = 0; i < 5; i++) await visit(`Old ${i}`, 500);
      const first = await runRetention(orgId, { batch: 2 });
      expect(first.counts).toMatchObject({ visitors: 5, tickets: 5, comments: 5, notifications: 5 });
      const second = await runRetention(orgId, { batch: 2 });
      expect(Object.values(second.counts).reduce((a, b) => a + b, 0)).toBe(0);
      const dry = await runRetention(orgId, { dryRun: true });
      expect(dry.counts.visitors).toBe(0);
    });

    it("keeps security-critical audit entries for at least 365 days and other entries for 30", async () => {
      const put = (action: string, days: number) =>
        db()
          .insert(auditLogs)
          .values({ organizationId: orgId, action, entityType: "x", at: ago(days) });
      await put("auth.login", 100);
      await put("setting.updated", 100);
      await put("branch.updated", 100);
      await put("branch.updated", 10);
      await put("auth.login", 500);
      await setPrivacy({ auditDays: 7 });
      const s = await runRetention(orgId);
      expect(s.counts.audit).toBe(2); // branch.updated 100 d, auth.login 500 d
      const left = await db()
        .select({ action: auditLogs.action, at: auditLogs.at })
        .from(auditLogs)
        .where(sql`entity_type = 'x'`);
      expect(left.map((l) => l.action).sort()).toEqual(["auth.login", "branch.updated", "setting.updated"]);
    });

    it("removes expired sessions, invites, reset tokens and pairing codes, not live ones", async () => {
      const khalid = (await actorFor("khalid@dor.local")).auth.user.id;
      await db()
        .insert(sessions)
        .values([
          { id: "old", userId: khalid, expiresAt: ago(40) },
          { id: "recent", userId: khalid, expiresAt: ago(3) },
          { id: "live", userId: khalid, expiresAt: new Date(NOW + DAY_MS) },
        ]);
      await db()
        .insert(passwordResetTokens)
        .values([
          { userId: khalid, tokenHash: "h1", expiresAt: ago(45) },
          { userId: khalid, tokenHash: "h2", expiresAt: new Date(NOW + DAY_MS) },
        ]);
      const [role] = await db().select({ id: roles.id }).from(roles).limit(1);
      await db()
        .insert(invites)
        .values([
          { organizationId: orgId, tokenHash: "i1", roleId: role.id, expiresAt: ago(50), email: "gone@example.com" },
          { organizationId: orgId, tokenHash: "i2", roleId: role.id, expiresAt: new Date(NOW + DAY_MS) },
        ]);
      const [screen] = await db()
        .insert(displays)
        .values({ organizationId: orgId, branchId, name: "tv", pairingCode: "ABC123", pairingExpiresAt: ago(40) })
        .returning();

      const s = await runRetention(orgId);
      expect(s.counts).toMatchObject({ sessions: 1, resetTokens: 1, invites: 1, pairingCodes: 1 });
      expect(
        (
          await db()
            .select()
            .from(sessions)
            .where(inArray(sessions.id, ["old", "recent", "live"]))
        )
          .map((x) => x.id)
          .sort(),
      ).toEqual(["live", "recent"]);
      expect((await db().select().from(displays).where(eq(displays.id, screen.id)))[0].pairingCode).toBeNull();
      expect((await db().select().from(invites).where(eq(invites.tokenHash, "i2"))).length).toBe(1);
    });

    it("the due check runs a missing day once and skips a recent run", async () => {
      await visit("Old", 500);
      await runDueRetention();
      expect((await lastRetentionRun(orgId))?.trigger).toBe("system");
      const count = async () => (await db().select().from(auditLogs).where(eq(auditLogs.action, "privacy.retention_run"))).length;
      expect(await count()).toBe(1);
      await runDueRetention();
      expect(await count()).toBe(1);
    });

    it("only organization-wide settings administrators preview or run it", async () => {
      await expectCode(runRetentionNow(damascusAdmin, true), "forbidden");
      await expectCode(retentionOverview(damascusAdmin), "forbidden");
      await expectCode(runRetentionNow(reception, false), "forbidden");
      const r = await runRetentionNow(admin, true);
      expect(r.summary.dryRun).toBe(true);
    });
  });

  describe("data-subject requests", () => {
    it("finds a visitor by phone (any notation), name (Arabic folding) and ticket number", async () => {
      const a = await visit("خالد الأحمد", 3);
      const t = await ticket(a.ticketId);
      expect((await findSubjects(admin, a.phone)).map((s) => s.id)).toEqual([a.visitorId]);
      expect((await findSubjects(admin, "+963" + a.phone.slice(1))).map((s) => s.id)).toEqual([a.visitorId]);
      expect((await findSubjects(admin, "خالد")).map((s) => s.id)).toContain(a.visitorId);
      expect((await findSubjects(admin, t.displayNumber.toLowerCase())).map((s) => s.id)).toContain(a.visitorId);
      expect(await findSubjects(admin, "nobody-like-this")).toEqual([]);
      const d = await subjectDetails(admin, a.visitorId);
      expect(d.held).toMatchObject({ tickets: 1, ticketsWithData: 1, feedback: 1, comments: 1, notifications: 1 });
      expect(d.phone).not.toBeNull();
    });

    it("export contains tickets, feedback and notification metadata, in JSON and CSV, and is recorded without personal data", async () => {
      const a = await visit("Sami", 3);
      const json = await exportSubject(admin, a.visitorId, { format: "json" });
      expect(json.filename).toMatch(/\.json$/);
      const data = JSON.parse(json.content);
      expect(data.subject).toMatchObject({ name: "Sami", phone: expect.any(String) });
      expect(data.tickets).toHaveLength(1);
      expect(data.tickets[0]).toMatchObject({ notes: "note of Sami", status: "COMPLETED" });
      expect(data.feedback[0]).toMatchObject({ score: 4, comment: "comment of Sami" });
      expect(data.notifications[0]).toMatchObject({ channel: "whatsapp", status: "sent", recipient: "+96394****12" });
      expect(data.notifications[0].payload).toBeUndefined();

      const csv = await exportSubject(admin, a.visitorId, { format: "csv" });
      expect(csv.mime).toContain("text/csv");
      expect(csv.content).toContain("section,record,field,value");
      expect(csv.content).toContain("feedback,1,comment,comment of Sami");

      const reqs = await db().select().from(privacyRequests);
      expect(reqs).toHaveLength(2);
      expect(reqs.every((r) => r.type === "access" && r.subjectRef === subjectRef("visitor", a.visitorId))).toBe(true);
      expect(JSON.stringify(reqs)).not.toContain("Sami");
      const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "privacy.access_exported"));
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain("Sami");
      expect(JSON.stringify(audits)).not.toContain(a.phone);
    });

    it("erasure needs a reason and confirmation, anonymises now, turns messages off, and audits without personal data", async () => {
      const a = await visit("Layla", 2);
      const b = await visit("Other", 2);
      await db()
        .insert(notificationsLog)
        .values({
          organizationId: orgId,
          branchId,
          ticketId: a.ticketId,
          channel: "sms",
          provider: "mock",
          event: "your_turn",
          status: "queued",
          payload: { channels: ["sms"] },
        });
      expect(erasureInput.safeParse({ reason: "x", confirm: true }).success).toBe(false);
      expect(erasureInput.safeParse({ reason: "visitor asked", confirm: false }).success).toBe(false);
      expect(erasureInput.safeParse({ reason: "visitor asked", confirm: true }).success).toBe(true);

      const filters = { from: "2026-07-01", to: "2026-09-30" };
      const before = JSON.stringify(await buildReport(admin, filters));
      const r = await eraseSubject(admin, a.visitorId, { reason: "visitor asked by phone", confirm: true });
      expect(r.cleared).toMatchObject({ visitor: 1, tickets: 1, comments: 1 });

      expect(await visitor(a.visitorId)).toMatchObject({
        name: null,
        phone: null,
        phoneHash: null,
        company: null,
        notificationsOptOut: true,
      });
      expect((await visitor(a.visitorId)).anonymizedAt).not.toBeNull();
      expect(await ticket(a.ticketId)).toMatchObject({ notes: null, intake: {} });
      expect(await comment(a.ticketId)).toBeNull();
      const logs = await db().select().from(notificationsLog).where(eq(notificationsLog.ticketId, a.ticketId));
      expect(logs.every((l) => l.recipientMasked === null)).toBe(true);
      expect(logs.find((l) => l.event === "your_turn")).toMatchObject({ status: "skipped", error: "opted_out" });
      expect(await visitor(b.visitorId)).toMatchObject({ name: "Other" });
      expect(JSON.stringify(await buildReport(admin, filters))).toBe(before);

      const [req] = await db().select().from(privacyRequests).where(eq(privacyRequests.type, "erasure"));
      expect(req).toMatchObject({ status: "completed", note: "visitor asked by phone", performedBy: admin.auth.user.id });
      expect(req.completedAt).not.toBeNull();
      const [entry] = await db().select().from(auditLogs).where(eq(auditLogs.action, "privacy.erasure"));
      expect(entry.entityId).toBe(req.id);
      const dump = JSON.stringify(entry);
      expect(dump).not.toContain("Layla");
      expect(dump).not.toContain(a.phone);
      expect(dump).toContain(subjectRef("visitor", a.visitorId));

      // The person can no longer be found by phone or name, and a repeat of the request is harmless.
      expect(await findSubjects(admin, a.phone)).toEqual([]);
      await eraseSubject(admin, a.visitorId, { reason: "again", confirm: true });
      expect((await listRequests(admin)).filter((x) => x.type === "erasure")).toHaveLength(2);
    });

    it("permissions: reception cannot use it; a city admin is limited to visitors wholly inside their branches", async () => {
      const dam = await visit("Damascene", 2);
      const both = await visit("Both Cities", 2);
      // Give "Both Cities" a second visit at the Aleppo branch.
      const second = await visit("Both Cities", 1, { branch: otherBranchId });
      await db().update(tickets).set({ visitorId: both.visitorId }).where(eq(tickets.id, second.ticketId));
      const noTickets = (
        await db()
          .insert(visitors)
          .values({ organizationId: orgId, name: "Walk In", nameSearch: "walk in" })
          .returning({ id: visitors.id })
      )[0].id;

      await expectCode(findSubjects(reception, "Damascene"), "forbidden");
      await expectCode(exportSubject(reception, dam.visitorId, { format: "json" }), "forbidden");
      await expectCode(eraseSubject(reception, dam.visitorId, { reason: "no right", confirm: true }), "forbidden");

      // Damascus admin: own visitor yes, the cross-city visitor and the visitor without tickets no.
      expect((await findSubjects(damascusAdmin, "Damascene")).map((s) => s.id)).toEqual([dam.visitorId]);
      expect(await findSubjects(damascusAdmin, "Both Cities")).toEqual([]);
      expect(await findSubjects(damascusAdmin, "Walk In")).toEqual([]);
      await expectCode(subjectDetails(damascusAdmin, both.visitorId), "not_found");
      await expectCode(eraseSubject(damascusAdmin, both.visitorId, { reason: "not mine", confirm: true }), "not_found");
      await expectCode(exportSubject(damascusAdmin, noTickets, { format: "json" }), "not_found");
      // Aleppo admin does not see the Damascus visitor.
      expect(await findSubjects(aleppoAdmin, "Damascene")).toEqual([]);
      await expectCode(eraseSubject(aleppoAdmin, dam.visitorId, { reason: "not mine", confirm: true }), "not_found");
      // Organization-wide sees all of them.
      expect((await findSubjects(admin, "Both Cities")).map((x) => x.id)).toContain(both.visitorId);
      expect((await findSubjects(admin, "Walk In")).length).toBe(1);

      await eraseSubject(damascusAdmin, dam.visitorId, { reason: "city request", confirm: true });
      expect((await visitor(dam.visitorId)).name).toBeNull();
      // History: the city admin sees only own requests, the organization admin sees all.
      await eraseSubject(admin, both.visitorId, { reason: "org request", confirm: true });
      expect((await listRequests(damascusAdmin)).map((r) => r.note)).toEqual(["city request"]);
      expect((await listRequests(admin)).length).toBe(2);
    });
  });

  describe("staff accounts", () => {
    it("anonymises a deactivated account, keeps the row and the audit trail, and refuses active accounts", async () => {
      const [khalid] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
      await db()
        .insert(userAvatars)
        .values({ userId: khalid.id, data: Buffer.from("img") });
      await db().update(users).set({ avatarVersion: 1 }).where(eq(users.id, khalid.id));
      await db()
        .insert(sessions)
        .values({ id: "ks", userId: khalid.id, expiresAt: new Date(NOW + DAY_MS) });
      await db()
        .insert(auditLogs)
        .values([
          {
            organizationId: orgId,
            entityType: "user",
            entityId: khalid.id,
            action: "user.updated",
            before: { email: "khalid@dor.local", isActive: true },
            after: { email: "k2@x.com", displayName: { en: "Khalid" }, isActive: true },
          },
          {
            organizationId: orgId,
            actorUserId: khalid.id,
            entityType: "ticket",
            action: "ticket.called",
            ip: "10.1.1.1",
            userAgent: "Firefox",
          },
        ]);

      await expectCode(anonymizeUser(admin, khalid.id, { reason: "left the company", confirm: true }), "conflict");
      await setUserActive(admin, khalid.id, false);
      await expectCode(anonymizeUser(reception, khalid.id, { reason: "left the company", confirm: true }), "forbidden");
      await anonymizeUser(admin, khalid.id, { reason: "left the company", confirm: true });

      const [u] = await db().select().from(users).where(eq(users.id, khalid.id));
      expect(u).toMatchObject({ phone: null, passwordHash: null, avatarVersion: null, isActive: false });
      expect(u.email).not.toContain("khalid");
      expect(u.displayName).toEqual({ ar: "مستخدم محذوف", en: "Deleted user" });
      expect(u.anonymizedAt).not.toBeNull();
      expect(await db().select().from(userAvatars).where(eq(userAvatars.userId, khalid.id))).toHaveLength(0);
      expect(await db().select().from(sessions).where(eq(sessions.userId, khalid.id))).toHaveLength(0);

      const trail = await db()
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.action, "user.updated")));
      expect(JSON.stringify(trail)).not.toContain("khalid@dor.local");
      expect(JSON.stringify(trail)).not.toContain("k2@x.com");
      expect((trail[0].after as { isActive: boolean }).isActive).toBe(true);
      const own = await db().select().from(auditLogs).where(eq(auditLogs.actorUserId, khalid.id));
      expect(own.find((e) => e.action === "ticket.called")).toMatchObject({ ip: null, userAgent: null });
      expect(await db().select().from(privacyRequests).where(eq(privacyRequests.subjectKind, "user"))).toHaveLength(1);
      await expectCode(anonymizeUser(admin, khalid.id, { reason: "left the company", confirm: true }), "conflict");
    });
  });
});
