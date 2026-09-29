import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import { logger } from "../logger";
import type { Channel, MessageProvider, OutboundMessage, SendResult } from "./types";

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
    const info = await this.transporter.sendMail({
      from: e.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html,
    });
    return { providerMessageId: info.messageId };
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
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mockOutbox().push({ ...message, id, at: new Date() });
    logger.info({ channel: message.channel, id }, "mock message recorded");
    return { providerMessageId: id };
  }
}

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
  // WhatsApp / SMS adapters are registered in the messaging milestone.
  return null;
}
