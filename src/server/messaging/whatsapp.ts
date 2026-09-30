import { env } from "../env";
import { httpRequest, isRetryableStatus, pickPath } from "./http";
import type { MessageProvider, OutboundMessage, SendResult } from "./types";

/** WhatsApp Cloud API without an SDK: `POST {graph}/{version}/{phone id}/messages`. */
export class WhatsAppCloudProvider implements MessageProvider {
  readonly id = "whatsapp-cloud";
  readonly channel = "whatsapp" as const;

  isConfigured() {
    const e = env();
    return !!e.WHATSAPP_TOKEN && !!e.WHATSAPP_PHONE_ID;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const e = env();
    const to = message.to.replace(/[^\d]/g, ""); // the API wants digits only, with the country code
    // A pre-approved template starts a conversation (business-initiated); plain text only works inside the 24-hour window.
    const payload = message.providerTemplate
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: message.providerTemplate,
            language: { code: message.locale },
            components: message.templateParams?.length
              ? [{ type: "body", parameters: message.templateParams.map((text) => ({ type: "text", text })) }]
              : [],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: true, body: message.text } };
    const out = await httpRequest(`${e.WHATSAPP_API_URL}/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if ("error" in out) return { ok: false, error: out.error, retryable: true };
    if (out.status >= 200 && out.status < 300) {
      return { ok: true, providerMessageId: pickPath(out.json, "messages.0.id"), retryable: false };
    }
    const err = (out.json as { error?: { message?: string; code?: number } } | null)?.error;
    return {
      ok: false,
      error: `whatsapp_${out.status}${err?.code ? `_${err.code}` : ""}: ${(err?.message ?? out.text).slice(0, 200)}`,
      retryable: isRetryableStatus(out.status),
    };
  }
}
