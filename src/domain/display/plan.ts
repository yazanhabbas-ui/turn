import type { DigitSystem } from "../i18n/digits";
import { renderTemplate } from "../templates/render";
import {
  arabicDeskWords,
  arabicTicketWords,
  buildArabicUnits,
  primaryKeys,
  unitsText,
  type SpeechUnit,
  type TicketReading,
} from "./arabic-speech";
import { announcementText, callSequence, type CallLanguages } from "./speech";

export type PlanSettings = {
  callLanguages: CallLanguages;
  ticketReading: TicketReading;
  /** Include the desk part ("please go to desk 3"). */
  announceDesk: boolean;
};

/** One thing to say: `text` for the browser voice, `units` (Arabic only) for recorded packs, `keys` = their primary clips. */
export type PlannedStep = { locale: string; text: string; keys: string[]; units?: SpeechUnit[] };

/**
 * The template without the clause that speaks the desk. Clauses are separated by commas, colons or full stops;
 * when nothing else mentions the ticket, only the ticket is left.
 */
export function withoutDesk(template: string): string {
  const parts = template.split(/(?<=[،,.;:؛])\s*/u);
  const kept = parts.filter((p) => !p.includes("{desk}"));
  if (kept.length && kept.some((p) => p.includes("{ticket}"))) return kept.join(" ").replace(/[،,.;:؛\s]+$/u, "");
  return "{ticket}";
}

/**
 * The speech steps for one call: one per language, using the editable voice template of that language for the
 * browser voice. Arabic steps also carry the natural-number units a recorded pack plays. A language without a
 * template is skipped (the admin removed it) rather than replaced by hard-coded text.
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
  const { ticketReading: reading, announceDesk } = input.settings;
  const steps: PlannedStep[] = [];
  for (const locale of callSequence(input.settings.callLanguages, input.ticketLanguage)) {
    const template = set[locale];
    if (!template) continue;
    const body = announceDesk ? template : withoutDesk(template);
    if (locale === "ar") {
      const units = buildArabicUnits({ ticket: input.displayNumber, desk: input.deskNumber, reading, includeDesk: announceDesk });
      steps.push({
        locale,
        // Words, not digits: Arabic voices read "أربعة عشر" far better than "B 14".
        text: renderTemplate(body, {
          ticket: arabicTicketWords(input.displayNumber, reading),
          desk: input.deskNumber ? arabicDeskWords(input.deskNumber) : "",
          agent: input.agent ?? "",
          reason: input.reason ?? "",
        }),
        keys: primaryKeys(units),
        units,
      });
      continue;
    }
    steps.push({
      locale,
      text: announcementText(
        body,
        { ticket: input.displayNumber, desk: input.deskNumber ?? "", agent: input.agent, reason: input.reason, reading },
        input.digits,
      ),
      keys: [],
    });
  }
  return steps;
}

/** The words a recorded Arabic pack speaks for a call, for the preview ("رقم بي، أربعة عشر، تفضل إلى المكتب ثلاثة"). */
export function packSpokenText(steps: PlannedStep[]): string {
  const ar = steps.find((s) => s.units);
  return ar?.units ? unitsText(ar.units) : "";
}
