import type { NotificationEvent } from "../settings/registry";
import type { Channel } from "../messaging/types";

type Loc = { ar: string; en: string };
export type DefaultTemplate = { channel: Channel; event: NotificationEvent; subject?: Loc; body: Loc };

const short = {
  ticket_issued: {
    ar: "أهلاً {name}\nرقمك {number} لخدمة {reason}.\nالانتظار المتوقع: {wait}\nتابع دورك من هنا: {link}",
    en: "Hello {name}\nYour number is {number} for {reason}.\nEstimated wait: {wait}\nTrack your turn here: {link}",
  },
  turns_away: {
    ar: "اقترب دورك! أمامك {ahead} قبل أن يحين دورك.\nرقمك {number}.\nتابع دورك: {link}",
    en: "Your turn is near! {ahead} ahead of you.\nYour number is {number}.\nTrack your turn: {link}",
  },
  called: {
    ar: "رقمك {number}: تفضل إلى المكتب {desk}.",
    en: "Number {number}: please go to desk {desk}.",
  },
  no_show: {
    ar: "لم نتمكن من العثور عليك عند مناداة الرقم {number}.\nيرجى مراجعة الاستقبال إن كنت لا تزال بحاجة إلى الخدمة.",
    en: "We could not find you when number {number} was called.\nPlease see reception if you still need service.",
  },
  completed_thanks: {
    ar: "شكراً لزيارتك {branch}.\nنقدّر رأيك في تجربتك: {feedbackLink}",
    en: "Thank you for visiting {branch}.\nWe would value your feedback: {feedbackLink}",
  },
} satisfies Record<NotificationEvent, Loc>;

const emailSubject = {
  ticket_issued: { ar: "رقمك {number} في {branch}", en: "Your number {number} at {branch}" },
  turns_away: { ar: "اقترب دورك، رقم {number}", en: "Your turn is near, number {number}" },
  called: { ar: "حان دورك، رقم {number}", en: "It is your turn, number {number}" },
  no_show: { ar: "فاتك دورك، رقم {number}", en: "You missed your turn, number {number}" },
  completed_thanks: { ar: "شكراً لزيارتك", en: "Thank you for your visit" },
} satisfies Record<NotificationEvent, Loc>;

const EVENTS = Object.keys(short) as NotificationEvent[];

/**
 * Wording used until an administrator edits a template, and the source for the rows the seed inserts. Placeholders:
 * {number} {name} {desk} {wait} {ahead} {branch} {reason} {link} {feedbackLink}.
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = EVENTS.flatMap((event) =>
  (["whatsapp", "sms", "email"] as const).map((channel) => ({
    channel,
    event,
    subject: channel === "email" ? emailSubject[event] : undefined,
    body: short[event],
  })),
);

export function defaultTemplate(channel: string, event: string): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.channel === channel && t.event === event);
}
