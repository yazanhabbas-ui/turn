import { env } from "../env";
import { httpRequest, isRetryableStatus, pickPath } from "./http";
import type { MessageProvider, OutboundMessage, SendResult } from "./types";

type Gateway = {
  id: string;
  url: string;
  method: "POST" | "PUT" | "GET";
  headers: Record<string, string>;
  format: "json" | "form";
  /** Body template with {to} {text} {from}. */
  body: string;
  messageIdPath?: string;
};

/** Twilio's Messages API as a preset of the generic gateway. */
function twilioGateway(): Gateway | null {
  const e = env();
  if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.SMS_FROM) return null;
  return {
    id: "sms-twilio",
    url: `https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`,
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
    format: "form",
    body: "To={to}&From={from}&Body={text}",
    messageIdPath: "sid",
  };
}

function httpGateway(): Gateway | null {
  const e = env();
  if (!e.SMS_URL) return null;
  const auth = e.SMS_AUTH_HEADER?.match(/^([^:]+):\s*(.+)$/);
  return {
    id: "sms-http",
    url: e.SMS_URL,
    method: e.SMS_METHOD,
    headers: auth ? { [auth[1].trim()]: auth[2].trim() } : {},
    format: e.SMS_BODY_FORMAT,
    body:
      e.SMS_BODY ||
      (e.SMS_BODY_FORMAT === "json" ? '{"to":"{to}","from":"{from}","text":"{text}"}' : "to={to}&from={from}&text={text}"),
    messageIdPath: e.SMS_MESSAGE_ID_PATH,
  };
}

export function smsGateway(): Gateway | null {
  const e = env();
  if (e.SMS_PROVIDER === "twilio") return twilioGateway();
  if (e.SMS_PROVIDER === "http" || e.SMS_URL) return httpGateway();
  return null;
}

/** Fills {to} {text} {from}; values are escaped for the body's format so a message can never break it. */
export function renderGatewayBody(template: string, format: "json" | "form", values: { to: string; text: string; from: string }) {
  return template.replace(/\{(to|text|from)\}/g, (_m, k: "to" | "text" | "from") =>
    format === "json" ? JSON.stringify(values[k]).slice(1, -1) : encodeURIComponent(values[k]),
  );
}

/** A generic HTTP SMS gateway (any regional provider, or Twilio through the preset). Configured from environment variables. */
export class HttpSmsProvider implements MessageProvider {
  readonly channel = "sms" as const;
  get id() {
    return smsGateway()?.id ?? "sms-http";
  }

  isConfigured() {
    return !!smsGateway();
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const gw = smsGateway();
    if (!gw) return { ok: false, error: "sms_not_configured", retryable: false };
    const values = { to: message.to, text: message.text, from: env().SMS_FROM ?? "" };
    const body = renderGatewayBody(gw.body, gw.format, values);
    let url = gw.url.replace(/\{(to|text|from)\}/g, (_m, k: "to" | "text" | "from") => encodeURIComponent(values[k]));
    const headers: Record<string, string> = { ...gw.headers };
    let init: RequestInit;
    if (gw.method === "GET") {
      url += (url.includes("?") ? "&" : "?") + body;
      init = { method: "GET", headers };
    } else {
      headers["Content-Type"] = gw.format === "json" ? "application/json" : "application/x-www-form-urlencoded";
      init = { method: gw.method, headers, body };
    }
    const out = await httpRequest(url, init);
    if ("error" in out) return { ok: false, error: out.error, retryable: true };
    if (out.status >= 200 && out.status < 300) {
      return { ok: true, providerMessageId: pickPath(out.json, gw.messageIdPath), retryable: false };
    }
    return { ok: false, error: `sms_${out.status}: ${out.text.slice(0, 200)}`, retryable: isRetryableStatus(out.status) };
  }
}
