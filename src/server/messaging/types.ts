export type Channel = "email" | "sms" | "whatsapp";

export type OutboundMessage = {
  channel: Channel;
  to: string;
  subject?: string;
  text: string;
  locale: string;
  /** Provider-side template (WhatsApp Business requires pre-approved templates) and its variables. */
  providerTemplate?: string | null;
  variables?: Record<string, string>;
};

export type SendResult = { providerMessageId?: string };

/**
 * A pluggable delivery provider. Ship: SMTP email, a mock (dev/test), and adapter stubs for
 * WhatsApp Business Cloud API / Twilio / local SMS gateways (messaging milestone).
 */
export interface MessageProvider {
  readonly id: string;
  readonly channel: Channel;
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}
