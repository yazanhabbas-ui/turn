export type Channel = "email" | "sms" | "whatsapp";
export const CHANNELS: readonly Channel[] = ["whatsapp", "sms", "email"];

export type OutboundMessage = {
  channel: Channel;
  to: string;
  subject?: string;
  text: string;
  locale: string;
  /** Provider-side template (WhatsApp Business requires pre-approved templates) and its variables. */
  providerTemplate?: string | null;
  variables?: Record<string, string>;
  /** Ordered values for the provider template's body parameters ({{1}}, {{2}}, …). */
  templateParams?: string[];
  /** Files sent with the message (email only). */
  attachments?: MessageAttachment[];
};

export type MessageAttachment = { filename: string; contentType: string; content: Buffer };

/**
 * What every adapter returns; adapters never throw for delivery problems.
 * `retryable` says whether trying again later can help (network error, timeout, 429, 5xx) or not (bad number, rejected content).
 */
export type SendResult = { ok: boolean; providerMessageId?: string; error?: string; retryable: boolean };

/** A pluggable delivery provider: SMTP email, WhatsApp Cloud API, an HTTP SMS gateway (with a Twilio preset), and a mock. */
export interface MessageProvider {
  readonly id: string;
  readonly channel: Channel;
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}
