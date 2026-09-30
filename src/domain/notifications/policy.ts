import { placeholdersOf, renderTemplate } from "../templates/render";

/** Pure rules for visitor notifications: no database, no clock, so they are easy to test. */

/** Events a visitor can be notified about, and the channels that can carry them. */
export const NOTIFICATION_EVENTS = ["ticket_issued", "turns_away", "called", "no_show", "completed_thanks"] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_CHANNELS = ["whatsapp", "sms", "email"] as const;
export type NotifyChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Placeholders a template may use; the admin editor shows them as chips. */
export const TEMPLATE_VARIABLES = [
  "number",
  "ticket",
  "name",
  "desk",
  "wait",
  "ahead",
  "branch",
  "reason",
  "link",
  "feedbackLink",
  "stopLink",
] as const;

/**
 * Placeholders that may be empty. A line that contains one of them is left out when it has no value, so
 * "Rate your visit: {feedbackLink}" disappears instead of printing an empty link.
 */
export const OPTIONAL_LINE_VARIABLES: readonly string[] = ["feedbackLink", "wait", "name"];

/** Renders a message; optional lines with an empty value are removed and blank runs collapsed. */
export function renderMessage(template: string, vars: Record<string, string | undefined>): string {
  const lines = template.split("\n").filter((line) => {
    for (const name of placeholdersOf(line)) {
      if (OPTIONAL_LINE_VARIABLES.includes(name) && !vars[name]) return false;
    }
    return true;
  });
  // Any other unknown placeholder is left visible on purpose (see renderTemplate); empty known ones become "".
  const filled = lines.map((line) => renderTemplate(line, { ...emptyKnown(vars), ...vars }));
  return filled
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyKnown(vars: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARIABLES.filter((k) => vars[k] === undefined).map((k) => [k, ""]));
}

/**
 * The channels to try for one notification, in order: the organization's channel order, keeping only channels the
 * event allows and for which the visitor has a contact.
 */
export function orderChannels(input: {
  order: readonly NotifyChannel[];
  allowedForEvent: Partial<Record<NotifyChannel, boolean>>;
  contacts: { phone: boolean; email: boolean };
}): NotifyChannel[] {
  return input.order.filter((c) => {
    if (!input.allowedForEvent[c]) return false;
    return c === "email" ? input.contacts.email : input.contacts.phone;
  });
}

export type SkipReason = "disabled" | "no_contact" | "no_consent" | "opted_out" | "limit_reached" | "no_channel";

/** Whether a notification may be queued at all. `null` = go ahead. */
export function shouldSkip(input: {
  enabled: boolean;
  eventEnabled: boolean;
  hasContact: boolean;
  requireConsent: boolean;
  consent: boolean;
  optedOut: boolean;
  countedForTicket: number;
  maxPerTicket: number;
  channels: readonly NotifyChannel[];
}): SkipReason | null {
  if (!input.enabled || !input.eventEnabled) return "disabled";
  if (!input.hasContact) return "no_contact";
  if (input.requireConsent && !input.consent) return "no_consent";
  if (input.optedOut) return "opted_out";
  if (input.countedForTicket >= input.maxPerTicket) return "limit_reached";
  if (!input.channels.length) return "no_channel";
  return null;
}

/** Seconds to wait before retry number `attempt` (1 = the first retry): the base, doubling each time, capped at an hour. */
export function retryDelaySeconds(baseSeconds: number, attempt: number): number {
  return Math.min(3600, baseSeconds * 2 ** Math.max(0, attempt - 1));
}

/** The dedupe key: one event is never sent twice for a ticket. */
export const dedupeKeyFor = (ticketId: string, event: string) => `${ticketId}:${event}`;

/** Sliding one-minute window per key; returns true when a send may go out now. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  take(key: string, perMinute: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
  /** Seconds until the next slot opens. */
  waitSeconds(key: string, now = Date.now()): number {
    const oldest = Math.min(...(this.hits.get(key) ?? [now]));
    return Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
  }
}

/** Basic email shape check for an address captured in the intake form. */
export const looksLikeEmail = (v: unknown): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
