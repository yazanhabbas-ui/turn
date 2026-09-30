import type { branches, desks, tickets, visitReasons, visitors } from "@/db/schema";
import { pickText } from "@/i18n/locales";
import { env } from "../env";
import { signStop } from "./optout";

type TicketRow = typeof tickets.$inferSelect;

export type TemplateVarsInput = {
  event: string;
  locale: string;
  ticket: TicketRow;
  visitor: typeof visitors.$inferSelect | null;
  branch: Pick<typeof branches.$inferSelect, "name"> | null;
  reason: Pick<typeof visitReasons.$inferSelect, "name"> | null;
  desk: Pick<typeof desks.$inferSelect, "number" | "name"> | null;
  /** Values captured when the event happened (position and wait), as text. */
  snapshot: { ahead?: string; wait?: string };
};

/** Returns extra variables for a message. Runs at send time, so it can create things (such as a feedback token). */
export type TemplateVarsProvider = (input: TemplateVarsInput) => Record<string, string> | Promise<Record<string, string>>;

const providers: TemplateVarsProvider[] = [];

/**
 * Extension point: other features add template variables here (for example the feedback module supplies
 * `feedbackLink`). Later registrations win. A variable left empty removes the template lines that use it.
 */
export function registerTemplateVars(provider: TemplateVarsProvider) {
  providers.push(provider);
}

export const publicLinkFor = (token: string) => `${env().APP_URL.replace(/\/$/, "")}/t/${token}`;

/**
 * The one place that decides what every placeholder means: {number} {ticket} {name} {desk} {wait} {ahead} {branch}
 * {reason} {link} {stopLink} and {feedbackLink} (empty unless a registered provider supplies it).
 */
export async function buildTemplateVars(input: TemplateVarsInput): Promise<Record<string, string>> {
  const { ticket, locale } = input;
  const link = publicLinkFor(ticket.publicToken);
  const vars: Record<string, string> = {
    number: ticket.displayNumber,
    ticket: ticket.displayNumber,
    name: input.visitor?.name?.trim() ?? "",
    desk: input.desk ? input.desk.number : "",
    wait: input.snapshot.wait ?? "",
    ahead: input.snapshot.ahead ?? "",
    branch: input.branch ? pickText(input.branch.name, locale) : "",
    reason: input.reason ? pickText(input.reason.name, locale) : "",
    link,
    stopLink: `${link}/stop?s=${signStop(ticket.publicToken)}`,
    feedbackLink: "",
  };
  for (const p of providers) Object.assign(vars, await p(input));
  return vars;
}
