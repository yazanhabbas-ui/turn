import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import { logger } from "../logger";
import { HttpSmsProvider } from "./sms";
import type { Channel, MessageProvider, OutboundMessage, SendResult } from "./types";
import { WhatsAppCloudProvider } from "./whatsapp";

export class SmtpEmailProvider implements MessageProvider {
  readonly id = "smtp";
  readonly channel = "email" as const;
  private transporter?: Transporter;

  isConfigured() {
    return !!env().SMTP_HOST;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const e = env();
    this.transporter ??= nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
    const dir = message.locale === "ar" ? "rtl" : "ltr";
    const html = `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;white-space:pre-line">${escapeHtml(message.text)}</div>`;
    try {
      const info = await this.transporter.sendMail({
        from: e.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
      });
      return { ok: true, providerMessageId: info.messageId, retryable: false };
    } catch (err) {
      // 5xx replies are temporary; 550-class rejections (bad mailbox) are not.
      const code = (err as { responseCode?: number }).responseCode;
      return {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : "smtp_error",
        retryable: !code || code < 500 || code === 503,
      };
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Records messages in memory instead of sending. Enabled with MESSAGING_MOCK=true (dev, tests, demos). */
export class MockProvider implements MessageProvider {
  readonly id = "mock";
  constructor(readonly channel: Channel) {}

  isConfigured() {
    return true;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (mockControl.failNext > 0) {
      mockControl.failNext--;
      return { ok: false, error: "mock_failure", retryable: mockControl.retryable };
    }
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mockOutbox().push({ ...message, id, at: new Date() });
    logger.info({ channel: message.channel, id }, "mock message recorded");
    return { ok: true, providerMessageId: id, retryable: false };
  }
}

/** Tests: make the next N mock sends fail (retryable or not). */
export const mockControl = { failNext: 0, retryable: true };

type Recorded = OutboundMessage & { id: string; at: Date };
const g = globalThis as unknown as { __dorOutbox?: Recorded[] };
export function mockOutbox(): Recorded[] {
  return (g.__dorOutbox ??= []);
}

/** Resolves the active provider for a channel, or null when the channel is not configured. */
export function providerFor(channel: Channel): MessageProvider | null {
  if (process.env.MESSAGING_MOCK === "true") return new MockProvider(channel);
  if (channel === "email") {
    const smtp = new SmtpEmailProvider();
    return smtp.isConfigured() ? smtp : null;
  }
  const p = channel === "whatsapp" ? new WhatsAppCloudProvider() : new HttpSmsProvider();
  return p.isConfigured() ? p : null;
}

export type ProviderStatus = { channel: Channel; state: "configured" | "not_configured" | "mock"; provider: string | null };

/** For the admin page: which channels can send right now, without revealing any secret. */
export function providerStatus(): ProviderStatus[] {
  const mock = process.env.MESSAGING_MOCK === "true";
  return (["whatsapp", "sms", "email"] as const).map((channel) => {
    const p = providerFor(channel);
    return { channel, provider: p?.id ?? null, state: !p ? "not_configured" : mock ? "mock" : "configured" };
  });
}
