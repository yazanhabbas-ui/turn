import { applyDigits, toWesternDigits, type DigitSystem } from "../i18n/digits";
import { renderTemplate } from "../templates/render";

/** Splits a formatted ticket number such as "A-014" (or "أ-٠١٤") into its letters and integer. */
export function splitTicket(displayNumber: string): { prefix: string; number: number } {
  const western = toWesternDigits(displayNumber).trim();
  const m = /^(.*?)[^\p{L}\p{N}]*(\d+)$/u.exec(western);
  if (!m) return { prefix: "", number: Number.NaN };
  return { prefix: m[1].trim(), number: Number(m[2]) };
}

/**
 * The ticket as it is spoken in a language without recorded clips (English, or the browser voice): letters, then
 * the number without leading zeros ("A-014" → "A 14"). Latin letters are spaced so a TTS engine reads them as a
 * letter, not as a word. `reading` "number_only" drops the letters, "digits" reads the number digit by digit.
 */
export function spokenTicket(
  displayNumber: string,
  digits: DigitSystem,
  reading: "letter_then_number" | "number_only" | "digits" = "letter_then_number",
): string {
  const { prefix, number } = splitTicket(displayNumber);
  if (Number.isNaN(number)) return applyDigits(displayNumber, digits);
  const letters = reading === "number_only" ? "" : prefix.split("").join(" ");
  const n = applyDigits(reading === "digits" ? String(number).split("").join(" ") : String(number), digits);
  return letters ? `${letters} ${n}` : n;
}

export type VoiceVars = {
  ticket: string;
  desk: string;
  agent?: string | null;
  reason?: string | null;
  reading?: "letter_then_number" | "number_only" | "digits";
};

/** Fills the voice template for one language; the ticket and desk are spoken in the configured digit system. */
export function announcementText(template: string, vars: VoiceVars, digits: DigitSystem): string {
  return renderTemplate(template, {
    ticket: spokenTicket(vars.ticket, digits, vars.reading),
    desk: applyDigits(vars.desk, digits),
    agent: vars.agent ?? "",
    reason: vars.reason ?? "",
  });
}

export const CALL_LANGUAGES = ["ar", "en", "ticket", "both_ar_en", "both_en_ar"] as const;
export type CallLanguages = (typeof CALL_LANGUAGES)[number];

/**
 * Languages to speak, in order. `ticket` = the language the visitor chose at reception; `both_*` speak the call
 * twice, in the given order. Never empty.
 */
export function callSequence(mode: CallLanguages, ticketLanguage: string): string[] {
  switch (mode) {
    case "en":
      return ["en"];
    case "ticket":
      return [ticketLanguage || "ar"];
    case "both_ar_en":
      return ["ar", "en"];
    case "both_en_ar":
      return ["en", "ar"];
    default:
      return ["ar"];
  }
}
