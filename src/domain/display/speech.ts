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
 * The ticket as it is spoken: letters, then the number without leading zeros ("A-014" → "A 14").
 * Latin letters are spaced so a TTS engine reads them as a letter, not as a word.
 */
export function spokenTicket(displayNumber: string, digits: DigitSystem): string {
  const { prefix, number } = splitTicket(displayNumber);
  if (Number.isNaN(number)) return applyDigits(displayNumber, digits);
  const letters = prefix.split("").join(" ");
  const n = applyDigits(String(number), digits);
  return letters ? `${letters} ${n}` : n;
}

export type VoiceVars = { ticket: string; desk: string; agent?: string | null; reason?: string | null };

/** Fills the voice template for one language; the ticket and desk are spoken in the configured digit system. */
export function announcementText(template: string, vars: VoiceVars, digits: DigitSystem): string {
  return renderTemplate(template, {
    ticket: spokenTicket(vars.ticket, digits),
    desk: applyDigits(vars.desk, digits),
    agent: vars.agent ?? "",
    reason: vars.reason ?? "",
  });
}

/**
 * Languages to speak, in order. `ticket` = the visitor's language only; otherwise the configured sequence
 * (e.g. Arabic then English). Never empty.
 */
export function speechLanguages(mode: "sequence" | "ticket", sequence: string[], ticketLanguage: string): string[] {
  if (mode === "ticket") return [ticketLanguage];
  return sequence.length ? sequence : [ticketLanguage || "ar"];
}

/** Clip keys for a pre-recorded voice pack: number, letters, digits and the fixed phrases around them. */
export function packClipKeys(displayNumber: string, desk: string, locale: string): string[] {
  const { prefix, number } = splitTicket(displayNumber);
  const keys = [`${locale}.phrase.number`];
  for (const ch of prefix) keys.push(`${locale}.letter.${ch.toUpperCase()}`);
  if (!Number.isNaN(number)) for (const d of String(number)) keys.push(`${locale}.digit.${d}`);
  keys.push(`${locale}.phrase.desk`);
  for (const ch of toWesternDigits(desk))
    keys.push(/\d/.test(ch) ? `${locale}.digit.${ch}` : `${locale}.letter.${ch.toUpperCase()}`);
  return keys;
}
