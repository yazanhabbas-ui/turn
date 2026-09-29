import type { DigitSystem } from "../i18n/digits";
import { announcementText, packClipKeys, speechLanguages } from "./speech";

export type PlanSettings = {
  mode: "sequence" | "ticket";
  languages: string[];
};

export type PlannedStep = { locale: string; text: string; keys: string[] };

/**
 * The speech steps for one call: one per language, using the editable voice template of that language.
 * A language without a template is skipped (the admin removed it) rather than replaced by hard-coded text.
 */
export function planAnnouncement(input: {
  /** `voice` templates by event, each `{ ar?: string, en?: string }`. */
  templates: Record<string, Record<string, string>>;
  event: "ticket_called" | "ticket_recalled";
  settings: PlanSettings;
  displayNumber: string;
  deskNumber: string | null;
  ticketLanguage: string;
  digits: DigitSystem;
  agent?: string | null;
  reason?: string | null;
}): PlannedStep[] {
  const set = input.templates[input.event] ?? input.templates.ticket_called ?? {};
  const steps: PlannedStep[] = [];
  for (const locale of speechLanguages(input.settings.mode, input.settings.languages, input.ticketLanguage)) {
    const template = set[locale];
    if (!template) continue;
    steps.push({
      locale,
      text: announcementText(
        template,
        { ticket: input.displayNumber, desk: input.deskNumber ?? "", agent: input.agent, reason: input.reason },
        input.digits,
      ),
      keys: packClipKeys(input.displayNumber, input.deskNumber ?? "", locale),
    });
  }
  return steps;
}
