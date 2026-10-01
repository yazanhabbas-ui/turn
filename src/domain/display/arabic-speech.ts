import { toWesternDigits } from "../i18n/digits";
import {
  ARABIC_LATIN_LETTERS,
  ARABIC_LETTER_NAMES,
  ARABIC_MAX_NUMBER,
  ARABIC_PHRASES,
  ARABIC_THOUSAND,
  ARABIC_UNITS,
  arabicNumberWords,
} from "./arabic-words";
import { splitTicket } from "./speech";

/**
 * How the ticket is read in Arabic:
 * - `letter_then_number`: "رقم بي، أربعة عشر" (the letter as an Arabic speaker says it, then a real Arabic number)
 * - `number_only`: "رقم أربعة عشر" (the prefix is skipped)
 * - `digits`: "رقم بي، واحد، أربعة" (digit by digit, the older behaviour)
 */
export const TICKET_READINGS = ["letter_then_number", "number_only", "digits"] as const;
export type TicketReading = (typeof TICKET_READINGS)[number];

/**
 * The deliberate pause placed BEFORE a unit (the engine reads its length from the voice settings):
 * `phrase` between "رقم" and the ticket, `letter` between letters and before the number, `desk` before the desk
 * phrase, `inner` inside a number or right after the desk phrase (no pause; overlap may apply).
 */
export type GapKind = "phrase" | "letter" | "desk" | "inner";

/**
 * One piece of speech. A unit with a `key` is played from that clip when the pack has it; otherwise its
 * `alternatives` are tried in order (each one a full replacement sequence, e.g. a number built from smaller
 * number clips, then digit by digit). `gap` is the pause before the unit; null for the very first one.
 */
export type SpeechUnit = {
  key?: string;
  /** What is said, for the on-screen preview and for the browser voice. */
  text: string;
  gap: GapKind | null;
  alternatives?: SpeechUnit[][];
};

const leaf = (key: string, text: string, gap: GapKind | null): SpeechUnit => ({ key, text, gap });

/** 0..9 as clips (`ar.digit.N`), spoken one after the other. */
function digitUnits(digits: string, firstGap: GapKind, betweenGap: GapKind): SpeechUnit[] {
  return [...digits].map((d, i) => leaf(`ar.digit.${d}`, ARABIC_UNITS[Number(d)], i === 0 ? firstGap : betweenGap));
}

/**
 * A whole number as Arabic speech. 0..999 is one clip (`ar.num.N`); if the pack lacks it, the number is built from
 * smaller pieces (hundreds, ones, tens), and as a last resort read digit by digit. 1 000..999 999 is the thousands
 * clip followed by the remainder. Larger numbers are read digit by digit.
 */
export function numberUnits(n: number, gap: GapKind): SpeechUnit[] {
  const digits = String(n);
  const asDigits = digitUnits(digits, gap, "letter");
  if (!Number.isInteger(n) || n < 0) return [];
  if (n > ARABIC_MAX_NUMBER) return asDigits;
  const text = arabicNumberWords(n);
  if (n < 1000) {
    // Without its own clip: hundreds + the rest (which may itself be ones + tens), then digit by digit.
    const alternatives: SpeechUnit[][] = [];
    const rest = n % 100;
    if (n >= 100 && rest) {
      const hundreds = Math.floor(n / 100) * 100;
      alternatives.push([leaf(`ar.num.${hundreds}`, arabicNumberWords(hundreds), gap), ...numberUnits(rest, "inner")]);
    } else if (n > 20 && n < 100 && n % 10) {
      const ten = n - (n % 10);
      alternatives.push([
        leaf(`ar.num.${n % 10}`, arabicNumberWords(n % 10), gap),
        leaf(`ar.num.${ten}`, arabicNumberWords(ten), "inner"),
      ]);
    }
    alternatives.push(asDigits);
    return [{ key: `ar.num.${n}`, text, gap, alternatives }];
  }
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head: SpeechUnit[] =
    thousands <= 10
      ? [leaf(`ar.num.${thousands * 1000}`, arabicNumberWords(thousands * 1000), gap)]
      : [...numberUnits(thousands, gap), leaf("ar.word.thousand", ARABIC_THOUSAND, "inner")];
  const tail = rest ? numberUnits(rest, "inner") : [];
  return [{ text, gap, alternatives: [[...head, ...tail], asDigits] }];
}

/** The clip of one prefix letter (a Latin letter as Arabic speakers name it, or an Arabic letter name). */
export function letterUnit(ch: string, gap: GapKind | null): SpeechUnit | null {
  const upper = ch.toUpperCase();
  const latin = ARABIC_LATIN_LETTERS[upper];
  if (latin) return leaf(`ar.letter.${upper}`, latin, gap);
  const arabic = ARABIC_LETTER_NAMES[ch];
  if (arabic) return leaf(`ar.letter.${ch}`, arabic, gap);
  return null;
}

export type ArabicCall = {
  /** Formatted ticket number such as "A-014" (Eastern digits are fine). */
  ticket: string;
  /** Desk number or name; null/empty = no desk part. */
  desk?: string | null;
  reading?: TicketReading;
  /** Include the "please go to the desk …" part. */
  includeDesk?: boolean;
};

/** Just the ticket: letters and number, in the chosen reading. Used with or without the leading "رقم". */
export function ticketUnits(ticket: string, reading: TicketReading, firstGap: GapKind | null): SpeechUnit[] {
  const { prefix, number } = splitTicket(ticket);
  if (Number.isNaN(number)) return [];
  const units: SpeechUnit[] = [];
  if (reading !== "number_only") {
    for (const ch of prefix) {
      const u = letterUnit(ch, units.length === 0 ? firstGap : "letter");
      if (u) units.push(u);
    }
  }
  const numberGap: GapKind = units.length ? "letter" : (firstGap ?? "phrase");
  units.push(...(reading === "digits" ? digitUnits(String(number), numberGap, "letter") : numberUnits(number, numberGap)));
  return units;
}

/** The full announcement as units: "رقم" + ticket [+ "تفضل إلى المكتب" + desk]. Empty when the number cannot be read. */
export function buildArabicUnits(call: ArabicCall): SpeechUnit[] {
  const reading = call.reading ?? "letter_then_number";
  const ticket = ticketUnits(call.ticket, reading, "phrase");
  if (!ticket.length) return [];
  const units: SpeechUnit[] = [leaf("ar.phrase.number", ARABIC_PHRASES.number, null), ...ticket];
  const desk = (call.desk ?? "").trim();
  if (desk && call.includeDesk !== false) {
    units.push(leaf("ar.phrase.desk", ARABIC_PHRASES.desk, "desk"));
    const d = splitTicket(desk);
    if (!Number.isNaN(d.number)) {
      let first = true;
      for (const ch of d.prefix) {
        const u = letterUnit(ch, first ? "inner" : "letter");
        if (u) {
          units.push(u);
          first = false;
        }
      }
      units.push(...numberUnits(d.number, first ? "inner" : "letter"));
    }
  }
  return units;
}

/**
 * Picks the clips to play: the unit's own clip when the pack has it, else the first alternative that the pack can
 * fully play. Returns null when some unit cannot be played at all (the provider then does not support the step).
 * The gap of a unit that is replaced by several clips goes to the first of them.
 */
export function resolveUnits(units: SpeechUnit[], has: (key: string) => boolean): { key: string; gap: GapKind | null }[] | null {
  const out: { key: string; gap: GapKind | null }[] = [];
  for (const u of units) {
    if (u.key && has(u.key)) {
      out.push({ key: u.key, gap: u.gap });
      continue;
    }
    let found: { key: string; gap: GapKind | null }[] | null = null;
    for (const alt of u.alternatives ?? []) {
      const r = resolveUnits(alt, has);
      if (r) {
        found = r;
        break;
      }
    }
    if (!found?.length) return null;
    found[0] = { ...found[0], gap: u.gap };
    out.push(...found);
  }
  return out;
}

/** Every clip key the announcement may ask for (own clips only, not the fallbacks). */
export function primaryKeys(units: SpeechUnit[]): string[] {
  return units.flatMap((u) => (u.key ? [u.key] : primaryKeys(u.alternatives?.[0] ?? [])));
}

/** The spoken words with light punctuation: "رقم بي أربعة عشر، تفضل إلى المكتب ثلاثة". */
export function unitsText(units: SpeechUnit[]): string {
  return units.reduce(
    (acc, u, i) => (i === 0 ? u.text : acc + (u.gap === "letter" || u.gap === "desk" ? "، " : " ") + u.text),
    "",
  );
}

/**
 * The ticket as words for the browser voice and the template placeholder `{ticket}`:
 * "بي أربعة عشر" (or just the number, or digit by digit).
 */
export function arabicTicketWords(ticket: string, reading: TicketReading): string {
  const units = ticketUnits(ticket, reading, null);
  return units.map((u) => u.text).join(reading === "digits" ? "، " : " ");
}

/** The desk as words ("ثلاثة"); the raw value when it is not a number. */
export function arabicDeskWords(desk: string): string {
  const d = splitTicket(desk);
  if (Number.isNaN(d.number)) return toWesternDigits(desk);
  const letters = [...d.prefix].map((ch) => letterUnit(ch, null)?.text ?? "").filter(Boolean);
  return [...letters, arabicNumberWords(d.number) || String(d.number)].join(" ");
}
