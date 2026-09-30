import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, notificationsLog, tickets, visitReasons, visitors } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { listNotificationLog, resendNotification, sendTestMessage } from "@/server/admin/notifications";
import { clearSettingOverride, updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { mockControl, mockOutbox } from "@/server/messaging/providers";
import { flushNotifications } from "@/server/notifications/dispatch";
import { optOutByToken, signStop } from "@/server/notifications/optout";
import { addVisitorContact } from "@/server/notifications/optin";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { defaultSetting } from "@/server/settings/registry";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("visitor notifications (database, mock provider)", () => {
  let admin: Actor;
  let reception: Actor;
  let noura: Actor;
  let branchId: string;
  let complaint: string;
  let phoneN = 0;

  const nextPhone = () => `09440000${String(++phoneN).padStart(2, "0")}`;
  const issue = async (fields: Record<string, string> = { phone: nextPhone() }, consent = true) => {
    const r = await issueTicket(reception, {
      branchId,
      reasonId: complaint,
      language: "ar",
      fields,
      consent,
      source: "reception",
    });
    await flushNotifications();
    advanceClock(0.1); // tickets issued in the same millisecond have no defined order
    return r.ticket;
  };
  const logs = (ticketId: string) => db().select().from(notificationsLog).where(eq(notificationsLog.ticketId, ticketId));
  const setNotif = (patch: Record<string, unknown>, branch: string | null = null) =>
    updateSetting(admin, "notifications", { ...defaultSetting("notifications"), ...patch }, branch);

  beforeEach(async () => {
    process.env.MESSAGING_MOCK = "true";
    setClock(Date.parse("2026-09-29T07:00:00Z"));
    mockOutbox().length = 0;
    mockControl.failNext = 0;
    mockControl.retryable = true;
    phoneN = 0;
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).limit(1);
    const [r] = await db().select().from(visitReasons).where(eq(visitReasons.code, "complaint"));
    complaint = r.id;
    // Let the complaint form also ask for an email address.
    await db()
      .update(visitReasons)
      .set({ intakeFields: [...r.intakeFields, { key: "email", required: false }] })
      .where(eq(visitReasons.id, r.id));
  });
  afterAll(async () => {
    delete process.env.MESSAGING_MOCK;
    await pool().end();
  });

  it("issuing a ticket sends the Arabic message with the number and the tracking link, and logs it", async () => {
    const t = await issue();
    expect(mockOutbox()).toHaveLength(1);
    const m = mockOutbox()[0];
    expect(m).toMatchObject({ channel: "whatsapp", locale: "ar" });
    expect(m.text).toContain(t.displayNumber);
    expect(m.text).toContain("رقمك");
    expect(m.text).toContain(`/t/${t.publicToken}`);
    expect(m.to).toMatch(/^\+9639440000/);
    const [row] = await logs(t.id);
    expect(row).toMatchObject({ event: "ticket_issued", status: "sent", provider: "mock", attempts: 1, channel: "whatsapp" });
    expect(row.recipientMasked).not.toContain("9440000"); // masked
    expect(row.recipientMasked).toContain("****");
  });

  it("does not send without the visitor's agreement, and never sends to a visitor without contact details", async () => {
    await updateSetting(admin, "privacy", { ...defaultSetting("privacy"), requireConsent: false });
    const t = await issue({ phone: nextPhone() }, false);
    expect(mockOutbox()).toHaveLength(0);
    expect(await logs(t.id)).toMatchObject([{ status: "skipped", error: "no_consent", event: "ticket_issued" }]);

    const [general] = await db().select().from(visitReasons).where(eq(visitReasons.code, "general"));
    const anon = (
      await issueTicket(reception, {
        branchId,
        reasonId: general.id,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      })
    ).ticket;
    await flushNotifications();
    expect(await logs(anon.id)).toHaveLength(0);
    expect(mockOutbox()).toHaveLength(0);
  });

  it("honours the visitor's opt-out on later visits and cancels pending messages", async () => {
    const phone = nextPhone();
    const first = await issue({ phone });
    expect(mockOutbox()).toHaveLength(1);
    expect(await optOutByToken(first.publicToken, "bad-signature-0000000000000000")).toBe("invalid");
    expect(await optOutByToken(first.publicToken, signStop(first.publicToken))).toBe("ok");
    const [v] = await db().select().from(visitors);
    expect(v.notificationsOptOut).toBe(true);

    const second = await issue({ phone });
    expect(mockOutbox()).toHaveLength(1);
    expect(await logs(second.id)).toMatchObject([{ status: "skipped", error: "opted_out" }]);
  });

  it("retries a temporary failure, then gives up and can be sent again by an administrator", async () => {
    await setNotif({ channelOrder: ["sms"], limits: { ...defaultSetting("notifications").limits, maxAttempts: 3 } });
    mockControl.failNext = 10;
    const t = await issue();
    expect(mockOutbox()).toHaveLength(0);
    const [row] = await logs(t.id);
    expect(row).toMatchObject({ status: "failed", attempts: 3, error: "mock_failure" });
    expect(mockControl.failNext).toBe(7);

    mockControl.failNext = 0;
    await resendNotification(admin, row.id);
    await flushNotifications();
    expect(mockOutbox()).toHaveLength(1);
    expect((await logs(t.id))[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("falls back to the next channel when one fails for good", async () => {
    await setNotif({ channelOrder: ["whatsapp", "sms", "email"] });
    mockControl.failNext = 1;
    mockControl.retryable = false;
    const t = await issue();
    expect(mockOutbox()).toHaveLength(1);
    expect(mockOutbox()[0].channel).toBe("sms");
    expect((await logs(t.id))[0]).toMatchObject({ status: "sent", channel: "sms", attempts: 2 });
  });

  it("adds the stop link to SMS and email, and uses the email address when that is the only contact", async () => {
    await setNotif({ channelOrder: ["email", "sms"] });
    const t = await issue({ phone: nextPhone(), email: "sara@example.com" });
    const mail = mockOutbox()[0];
    expect(mail).toMatchObject({ channel: "email", to: "sara@example.com" });
    expect(mail.subject).toContain(t.displayNumber);
    expect(mail.text).toContain(`/t/${t.publicToken}/stop?s=${signStop(t.publicToken)}`);

    await setNotif({ channelOrder: ["sms"] });
    const t2 = await issue();
    expect(mockOutbox()[1].text).toContain("/stop?s=");
    expect(t2.id).not.toBe(t.id);
  });

  it("'turns away' is sent once, when the visitor's position crosses the threshold", async () => {
    await setAgentStatus(noura, { status: "AVAILABLE" });
    const list = [];
    for (let i = 0; i < 4; i++) list.push(await issue());
    const turnsAway = async () =>
      (await db().select().from(notificationsLog).where(eq(notificationsLog.event, "turns_away"))).map((r) => r.ticketId);
    expect(await turnsAway()).toEqual([]); // nobody has moved yet

    const called = await callNext(noura, {});
    await flushNotifications();
    expect(called.ticket?.id).toBe(list[0].id);
    // The fourth visitor went from three ahead to two ahead (the default threshold).
    expect(await turnsAway()).toEqual([list[3].id]);
    const sent = mockOutbox().filter((m) => m.text.includes("اقترب دورك"));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(list[3].displayNumber);

    await ticketAction(noura, list[0].id, { action: "start" });
    await ticketAction(noura, list[0].id, { action: "complete" });
    await callNext(noura, {});
    await flushNotifications();
    expect(await turnsAway()).toEqual([list[3].id]); // still once
    // The visitor called at the desk got the desk number.
    const callMsg = mockOutbox().find((m) => m.text.includes("تفضل إلى المكتب"));
    expect(callMsg).toBeDefined();
  });

  it("a disabled event sends nothing; a branch can turn an event off for itself only", async () => {
    await setAgentStatus(noura, { status: "AVAILABLE" });
    const org = defaultSetting("notifications");
    const calledOff = { events: { ...org.events, called: { ...org.events.called, enabled: false } } };
    const callAndFinish = async (ticketId: string) => {
      mockOutbox().length = 0;
      const called = await callNext(noura, {});
      await flushNotifications();
      expect(called.ticket?.id).toBe(ticketId);
      const sent = mockOutbox().length;
      await ticketAction(noura, ticketId, { action: "start" });
      await ticketAction(noura, ticketId, { action: "complete" });
      return sent;
    };

    await setNotif(calledOff);
    const t1 = await issue();
    expect(await callAndFinish(t1.id)).toBe(0);
    expect((await logs(t1.id)).map((r) => r.event)).toEqual(["ticket_issued"]);

    // On for the organization, off for this branch.
    await setNotif({});
    await setNotif(calledOff, branchId);
    const t2 = await issue();
    expect(await callAndFinish(t2.id)).toBe(0);

    await clearSettingOverride(admin, "notifications", branchId);
    const t3 = await issue();
    expect(await callAndFinish(t3.id)).toBe(1);
    expect((await logs(t3.id)).map((r) => r.event).sort()).toEqual(["called", "ticket_issued"]);
  });

  it("never sends more than the per-ticket limit and never the same event twice", async () => {
    await setNotif({ limits: { ...defaultSetting("notifications").limits, maxPerTicket: 1 } });
    await setAgentStatus(noura, { status: "AVAILABLE" });
    const t = await issue();
    await callNext(noura, {});
    await flushNotifications();
    const rows = await logs(t.id);
    expect(rows.find((r) => r.event === "ticket_issued")?.status).toBe("sent");
    expect(rows.find((r) => r.event === "called")).toMatchObject({ status: "skipped", error: "limit_reached" });
    expect(mockOutbox()).toHaveLength(1);
    // The same event again is ignored by the unique dedupe key.
    const [dup] = await db()
      .insert(notificationsLog)
      .values({
        organizationId: rows[0].organizationId,
        ticketId: t.id,
        channel: "sms",
        provider: "x",
        event: "called",
        dedupeKey: `${t.id}:called`,
      })
      .onConflictDoNothing()
      .returning();
    expect(dup).toBeUndefined();
  });

  it("a visitor without a phone can ask for updates from the status page", async () => {
    const [general] = await db().select().from(visitReasons).where(eq(visitReasons.code, "general"));
    const t = (
      await issueTicket(reception, {
        branchId,
        reasonId: general.id,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      })
    ).ticket;
    await flushNotifications();
    expect(mockOutbox()).toHaveLength(0);
    await addVisitorContact(t.publicToken, "0944 000 099");
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.consentAt).not.toBeNull();
    const sara = await actorFor("sara@dor.local");
    await setAgentStatus(sara, { status: "AVAILABLE" });
    await callNext(sara, {});
    await flushNotifications();
    expect(mockOutbox()).toHaveLength(1);
    expect(mockOutbox()[0].to).toBe("+963944000099");
    await expect(addVisitorContact(t.publicToken, "0944 000 098")).rejects.toMatchObject({ code: "conflict" });
  });

  it("the log shows masked recipients, city admins only see their branches, and the test message works", async () => {
    await issue();
    const all = await listNotificationLog(admin, { limit: 50 });
    expect(all.items).toHaveLength(1);
    expect(all.items[0].recipientMasked).toContain("****");
    expect(JSON.stringify(all)).not.toContain("9440000");
    const aleppo = await actorFor("aleppo.admin@dor.local");
    expect((await listNotificationLog(aleppo, { limit: 50 })).items).toHaveLength(0);
    const damascus = await actorFor("damascus.admin@dor.local");
    expect((await listNotificationLog(damascus, { limit: 50 })).items).toHaveLength(1);
    await expect(sendTestMessage(damascus, { channel: "email", to: "a@b.co", locale: "ar" })).rejects.toMatchObject({
      code: "forbidden",
    });

    mockOutbox().length = 0;
    await sendTestMessage(admin, { channel: "email", to: "me@example.com", locale: "en" });
    expect(mockOutbox()[0]).toMatchObject({ channel: "email", to: "me@example.com" });
  });
});
