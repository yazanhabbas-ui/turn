import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dedupeKeyFor,
  looksLikeEmail,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  orderChannels,
  RateLimiter,
  renderMessage,
  retryDelaySeconds,
  shouldSkip,
} from "@/domain/notifications/policy";
import { HttpSmsProvider, renderGatewayBody } from "@/server/messaging/sms";
import { WhatsAppCloudProvider } from "@/server/messaging/whatsapp";
import { DEFAULT_TEMPLATES } from "@/server/notifications/defaults";
import { signStop, verifyStop } from "@/server/notifications/optout";
import { buildTemplateVars, registerTemplateVars } from "@/server/notifications/vars";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

describe("template rendering", () => {
  const vars = { number: "A-014", desk: "3", link: "https://q/t/x" };

  it("fills placeholders and keeps unknown ones visible", () => {
    expect(renderMessage("رقمك {number} إلى المكتب {desk} {oops}", vars)).toBe("رقمك A-014 إلى المكتب 3 {oops}");
  });

  it("drops a line whose optional value is empty, keeps it when there is a value", () => {
    const tpl = "شكراً\nقيّم زيارتك: {feedbackLink}\nوداعاً";
    expect(renderMessage(tpl, { feedbackLink: "" })).toBe("شكراً\nوداعاً");
    expect(renderMessage(tpl, {})).toBe("شكراً\nوداعاً");
    expect(renderMessage(tpl, { feedbackLink: "https://f/1" })).toBe("شكراً\nقيّم زيارتك: https://f/1\nوداعاً");
  });

  it("leaves out the greeting and wait lines when there is no name or estimate", () => {
    const tpl = "أهلاً {name}\nرقمك {number}\nالانتظار: {wait}";
    expect(renderMessage(tpl, { name: "", number: "A-1", wait: "" })).toBe("رقمك A-1");
    expect(renderMessage(tpl, { name: "سارة", number: "A-1", wait: "5 دقائق" })).toBe("أهلاً سارة\nرقمك A-1\nالانتظار: 5 دقائق");
  });

  it("ships Arabic and English wording for every channel and event", () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_EVENTS.length);
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.ar.length).toBeGreaterThan(5);
      expect(t.body.en.length).toBeGreaterThan(5);
      if (t.channel === "email") expect(t.subject?.ar && t.subject.en).toBeTruthy();
    }
    // The thank-you message survives without a feedback link (the CSAT link is optional).
    const thanks = DEFAULT_TEMPLATES.find((t) => t.event === "completed_thanks")!;
    expect(renderMessage(thanks.body.ar, { branch: "فرع", feedbackLink: "" })).not.toContain("{");
  });
});

describe("channel order, fallback and limits", () => {
  const allowed = { whatsapp: true, sms: true, email: true };

  it("follows the organization order and keeps only usable channels", () => {
    const order = ["whatsapp", "sms", "email"] as const;
    expect(orderChannels({ order, allowedForEvent: allowed, contacts: { phone: true, email: true } })).toEqual([
      "whatsapp",
      "sms",
      "email",
    ]);
    expect(orderChannels({ order, allowedForEvent: allowed, contacts: { phone: false, email: true } })).toEqual(["email"]);
    expect(
      orderChannels({
        order: ["email", "sms"],
        allowedForEvent: { ...allowed, email: false },
        contacts: { phone: true, email: true },
      }),
    ).toEqual(["sms"]);
  });

  const base = {
    enabled: true,
    eventEnabled: true,
    hasContact: true,
    requireConsent: true,
    consent: true,
    optedOut: false,
    countedForTicket: 0,
    maxPerTicket: 5,
    channels: ["sms"] as const,
  };

  it("decides why a message is not sent", () => {
    expect(shouldSkip(base)).toBeNull();
    expect(shouldSkip({ ...base, enabled: false })).toBe("disabled");
    expect(shouldSkip({ ...base, eventEnabled: false })).toBe("disabled");
    expect(shouldSkip({ ...base, hasContact: false })).toBe("no_contact");
    expect(shouldSkip({ ...base, consent: false })).toBe("no_consent");
    expect(shouldSkip({ ...base, consent: false, requireConsent: false })).toBeNull();
    expect(shouldSkip({ ...base, optedOut: true })).toBe("opted_out");
    expect(shouldSkip({ ...base, countedForTicket: 5 })).toBe("limit_reached");
    expect(shouldSkip({ ...base, channels: [] })).toBe("no_channel");
  });

  it("de-duplicates by ticket and event", () => {
    expect(dedupeKeyFor("t1", "called")).toBe("t1:called");
    expect(dedupeKeyFor("t1", "called")).toBe(dedupeKeyFor("t1", "called"));
    expect(dedupeKeyFor("t1", "called")).not.toBe(dedupeKeyFor("t1", "no_show"));
  });

  it("backs off exponentially, capped at an hour", () => {
    expect([1, 2, 3, 4].map((n) => retryDelaySeconds(30, n))).toEqual([30, 60, 120, 240]);
    expect(retryDelaySeconds(30, 20)).toBe(3600);
  });

  it("limits sends per minute per provider", () => {
    const l = new RateLimiter();
    expect(l.take("p", 2, 0)).toBe(true);
    expect(l.take("p", 2, 1000)).toBe(true);
    expect(l.take("p", 2, 2000)).toBe(false);
    expect(l.take("other", 2, 2000)).toBe(true);
    expect(l.take("p", 2, 61_000)).toBe(true);
  });

  it("recognises an email address", () => {
    expect(looksLikeEmail("sara@example.com")).toBe(true);
    expect(looksLikeEmail("sara@")).toBe(false);
    expect(looksLikeEmail(undefined)).toBe(false);
  });
});

describe("notifications setting", () => {
  it("is safe by default: on, needs consent, thanks off, at most five messages", () => {
    const s = defaultSetting("notifications");
    expect(s).toMatchObject({ enabled: true, requireConsent: true });
    expect(s.channelOrder).toEqual(["whatsapp", "sms", "email"]);
    expect(s.limits.maxPerTicket).toBe(5);
    expect(s.events.completed_thanks.enabled).toBe(false);
    expect(s.events.ticket_issued.enabled).toBe(true);
  });

  it("removes duplicate channels from the order and falls back to defaults when invalid", () => {
    expect(parseSetting("notifications", { channelOrder: ["sms", "sms", "email"] }).channelOrder).toEqual(["sms", "email"]);
    expect(parseSetting("notifications", { limits: { maxPerTicket: 999 } }).limits.maxPerTicket).toBe(5);
  });
});

describe("opt-out link and template variables", () => {
  it("signs and verifies the stop link", () => {
    const sig = signStop("token123");
    expect(verifyStop("token123", sig)).toBe(true);
    expect(verifyStop("token124", sig)).toBe(false);
    expect(verifyStop("token123", "0".repeat(32))).toBe(false);
  });

  it("builds variables and lets other modules add the feedback link", async () => {
    const input = {
      event: "completed_thanks",
      locale: "ar",
      ticket: { displayNumber: "B-002", publicToken: "tok" } as never,
      visitor: { name: "سارة" } as never,
      branch: { name: { ar: "فرع دمشق", en: "Damascus" } },
      reason: { name: { ar: "خدمة", en: "Service" } },
      desk: { number: "4", name: { ar: "4", en: "4" } },
      snapshot: { ahead: "2", wait: "5" },
    };
    const before = await buildTemplateVars(input);
    expect(before).toMatchObject({ number: "B-002", name: "سارة", desk: "4", branch: "فرع دمشق", feedbackLink: "" });
    expect(before.link).toMatch(/\/t\/tok$/);
    expect(before.stopLink).toContain("/t/tok/stop?s=");
    registerTemplateVars((i) => ({ feedbackLink: `https://f/${i.ticket.publicToken}` }));
    expect((await buildTemplateVars(input)).feedbackLink).toBe("https://f/tok");
  });
});

describe("provider adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("escapes values in a gateway body for JSON and forms", () => {
    const v = { to: "+963944123456", text: 'قال "مرحبا"\nسطر', from: "Dor" };
    const json = renderGatewayBody('{"to":"{to}","text":"{text}"}', "json", v);
    expect(JSON.parse(json)).toEqual({ to: "+963944123456", text: 'قال "مرحبا"\nسطر' });
    expect(renderGatewayBody("To={to}&Body={text}", "form", v)).toBe(`To=%2B963944123456&Body=${encodeURIComponent(v.text)}`);
  });

  it("WhatsApp sends an approved template when one is set, plain text otherwise, and classifies errors", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_ID", "555");
    // env() caches, so read through a fresh module instance.
    vi.resetModules();
    const { WhatsAppCloudProvider: P } = await import("@/server/messaging/whatsapp");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return calls.length === 3
          ? new Response(JSON.stringify({ error: { code: 131026, message: "Undeliverable" } }), { status: 400 })
          : calls.length === 4
            ? new Response("busy", { status: 503 })
            : new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
      }),
    );
    const p = new P();
    expect(p.isConfigured()).toBe(true);
    const tpl = await p.send({
      channel: "whatsapp",
      to: "+963 944-123-456",
      text: "x",
      locale: "ar",
      providerTemplate: "ticket_issued_ar",
      templateParams: ["A-1", "5"],
    });
    expect(tpl).toMatchObject({ ok: true, providerMessageId: "wamid.1" });
    expect(calls[0].url).toContain("/555/messages");
    expect(calls[0].body).toMatchObject({
      to: "963944123456",
      type: "template",
      template: { name: "ticket_issued_ar", language: { code: "ar" } },
    });
    await p.send({ channel: "whatsapp", to: "+963944123456", text: "hello", locale: "en" });
    expect(calls[1].body).toMatchObject({ type: "text", text: { body: "hello" } });
    expect(await p.send({ channel: "whatsapp", to: "+963944123456", text: "x", locale: "en" })).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(await p.send({ channel: "whatsapp", to: "+963944123456", text: "x", locale: "en" })).toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("the generic SMS gateway maps the body and reads the message id; a network error is retryable", async () => {
    vi.stubEnv("SMS_URL", "https://sms.example/send");
    vi.stubEnv("SMS_AUTH_HEADER", "X-Api-Key: secret");
    vi.stubEnv("SMS_BODY", '{"msisdn":"{to}","message":"{text}"}');
    vi.stubEnv("SMS_MESSAGE_ID_PATH", "data.id");
    vi.resetModules();
    const { HttpSmsProvider: P } = await import("@/server/messaging/sms");
    let seen: { url: string; init: { headers: Record<string, string>; body: string } } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
        seen = { url, init };
        return new Response(JSON.stringify({ data: { id: "m-9" } }), { status: 200 });
      }),
    );
    const p = new P();
    expect(p.isConfigured()).toBe(true);
    expect(await p.send({ channel: "sms", to: "+963944123456", text: "hi", locale: "en" })).toMatchObject({
      ok: true,
      providerMessageId: "m-9",
    });
    expect(seen!.init.headers["X-Api-Key"]).toBe("secret");
    expect(JSON.parse(seen!.init.body)).toEqual({ msisdn: "+963944123456", message: "hi" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    expect(await p.send({ channel: "sms", to: "+963944123456", text: "hi", locale: "en" })).toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("Twilio preset needs account, token and sender", async () => {
    vi.stubEnv("SMS_PROVIDER", "twilio");
    vi.resetModules();
    const { HttpSmsProvider: P } = await import("@/server/messaging/sms");
    expect(new P().isConfigured()).toBe(false);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tt");
    vi.stubEnv("SMS_FROM", "+15550001");
    vi.resetModules();
    const { HttpSmsProvider: Q } = await import("@/server/messaging/sms");
    expect(new Q().isConfigured()).toBe(true);
    expect(new Q().id).toBe("sms-twilio");
  });

  it("classes are exported", () => {
    expect(typeof WhatsAppCloudProvider).toBe("function");
    expect(typeof HttpSmsProvider).toBe("function");
  });
});
