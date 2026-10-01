import { planGroupAnnouncement, type AnnounceItem, type AnnounceMode, type GroupAnnouncement } from "../halls/announce";
import { applyDigits, type DigitSystem } from "../i18n/digits";
import {
  placeUnits,
  phraseUnit,
  primaryKeys,
  ticketUnits,
  unitsText,
  type SpeechUnit,
  type TicketReading,
} from "./arabic-speech";
import { ARABIC_HALL_PHRASE_KEYS } from "./arabic-words";
import { spokenTicket, callSequence, type CallLanguages } from "./speech";
import type { PlannedStep } from "./plan";

/** What a group call to a hall says (D62). The numbers shown are already limited by `announce`. */
export type HallCall = {
  /** Display numbers of every visitor called to the hall. */
  displayNumbers: string[];
  /** The hall number as shown ("2"). */
  hallNumber: string;
  announce: { mode: AnnounceMode; maxAnnounced: number };
  reading: TicketReading;
};

/** The English wording (the browser voice). Arabic wording lives in ARABIC_PHRASES, recorded as clips. */
export const EN_HALL_PHRASES = {
  ticket: "Ticket",
  tickets: "Tickets",
  and: "and",
  from: "from",
  to: "to",
  nextGroup: "The next group",
  goToHall: "please go to hall",
} as const;

const phrase = phraseUnit;

function itemUnits(item: AnnounceItem, reading: TicketReading, gap: "phrase" | "letter"): SpeechUnit[] {
  if (item.kind === "ticket") return ticketUnits(item.displayNumber, reading, gap);
  return [
    phrase("range_from", gap),
    ...ticketUnits(item.from, reading, "inner"),
    phrase("range_to", "letter"),
    ...ticketUnits(item.to, reading, "inner"),
  ];
}

/**
 * The Arabic announcement of a group call as speech units:
 *  - one visitor: "رقم بي أربعة عشر، تفضل إلى القاعة اثنان"
 *  - list: "الأرقام بي أربعة عشر، بي خمسة عشر، وبي ستة عشر، تفضلوا إلى القاعة اثنان"
 *  - range: "الأرقام من بي عشرة إلى بي اثنا عشر، تفضلوا إلى القاعة اثنان"
 *  - the next group: "المجموعة التالية، تفضلوا إلى القاعة اثنان"
 * Every number reuses the single-ticket composition, so the same clips (and fallbacks) apply.
 */
export function buildHallArabicUnits(call: HallCall, plan?: GroupAnnouncement): SpeechUnit[] {
  const p = plan ?? planGroupAnnouncement(call.displayNumbers, call.announce.mode, call.announce.maxAnnounced);
  const units: SpeechUnit[] = [];
  const single = p.mode === "list" && p.items.length === 1 && p.total === 1;
  if (p.mode === "group_only") {
    units.push(phrase("next_group", null));
  } else if (single && p.items[0].kind === "ticket") {
    const t = ticketUnits(p.items[0].displayNumber, call.reading, "phrase");
    if (!t.length) return [];
    units.push(phrase("number", null), ...t);
  } else {
    units.push(phrase("group_numbers", null));
    p.items.forEach((item, i) => {
      const last = i === p.items.length - 1 && p.items.length > 1;
      const first = i === 0;
      if (last) units.push(phrase("and", "letter"));
      const body = itemUnits(item, call.reading, first ? "phrase" : "letter");
      // After "و" the next piece follows directly; the first item follows "الأرقام" after a short pause.
      if (last && body.length) body[0] = { ...body[0], gap: "inner" };
      units.push(...body);
    });
  }
  const hall = placeUnits(call.hallNumber);
  const place = single ? phrase("please_go_to_hall_single", "desk") : phrase("please_go_to_hall", "desk");
  units.push(place, ...hall);
  return units;
}

/** The phrase keys (`ar.phrase.*`) a group call needs from a recorded pack, besides numbers and letters. */
export function requiredHallPhraseKeys(plan: GroupAnnouncement): string[] {
  const keys = new Set<string>();
  const single = plan.mode === "list" && plan.total === 1;
  if (plan.mode === "group_only") keys.add("ar.phrase.next_group");
  else if (single) keys.add("ar.phrase.number");
  else {
    keys.add("ar.phrase.group_numbers");
    if (plan.items.length > 1) keys.add("ar.phrase.and");
    if (plan.items.some((i) => i.kind === "range")) {
      keys.add("ar.phrase.range_from");
      keys.add("ar.phrase.range_to");
    }
  }
  keys.add(single ? "ar.phrase.please_go_to_hall_single" : "ar.phrase.please_go_to_hall");
  return [...keys];
}

/** The group-call phrases a pack is missing (empty = the pack can speak every kind of group call). */
export function missingHallPhraseKeys(manifest: Record<string, string> | undefined, plan?: GroupAnnouncement): string[] {
  const wanted = plan ? requiredHallPhraseKeys(plan) : ARABIC_HALL_PHRASE_KEYS.map((k) => `ar.phrase.${k}`);
  return wanted.filter((k) => !manifest?.[k]);
}

/** English wording of a group call: "Tickets A 14, A 15 and A 16, please go to hall 2". */
export function hallEnglishText(call: HallCall, digits: DigitSystem, plan?: GroupAnnouncement): string {
  const p = plan ?? planGroupAnnouncement(call.displayNumbers, call.announce.mode, call.announce.maxAnnounced);
  const E = EN_HALL_PHRASES;
  const hall = applyDigits(call.hallNumber, digits);
  const say = (d: string) => spokenTicket(d, digits, call.reading);
  if (p.mode === "group_only") return `${E.nextGroup}, ${E.goToHall} ${hall}`;
  const parts = p.items.map((i) => (i.kind === "ticket" ? say(i.displayNumber) : `${E.from} ${say(i.from)} ${E.to} ${say(i.to)}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ${E.and} ${parts[parts.length - 1]}` : parts[0];
  return `${p.total === 1 ? E.ticket : E.tickets} ${list}, ${E.goToHall} ${hall}`;
}

/** The Arabic words of the call for the browser voice when no recorded pack can say it. */
export function hallArabicText(call: HallCall, plan?: GroupAnnouncement): string {
  const units = buildHallArabicUnits(call, plan);
  return unitsText(units);
}

export type HallPlanInput = {
  settings: { callLanguages: CallLanguages; ticketReading: TicketReading };
  hallNumber: string;
  displayNumbers: string[];
  announce: { mode: AnnounceMode; maxAnnounced: number };
  /** The language of the first visitor (for the "ticket" setting). */
  ticketLanguage: string;
  digits: DigitSystem;
};

/** The speech steps of a group call: one per language, Arabic with units for recorded packs. */
export function planHallAnnouncement(input: HallPlanInput): PlannedStep[] {
  if (!input.displayNumbers.length) return [];
  const call: HallCall = {
    displayNumbers: input.displayNumbers,
    hallNumber: input.hallNumber,
    announce: input.announce,
    reading: input.settings.ticketReading,
  };
  const plan = planGroupAnnouncement(call.displayNumbers, call.announce.mode, call.announce.maxAnnounced);
  const steps: PlannedStep[] = [];
  for (const locale of callSequence(input.settings.callLanguages, input.ticketLanguage)) {
    if (locale === "ar") {
      const units = buildHallArabicUnits(call, plan);
      if (!units.length) continue;
      steps.push({ locale, text: unitsText(units), keys: primaryKeys(units), units });
    } else {
      steps.push({ locale, text: hallEnglishText(call, input.digits, plan), keys: [] });
    }
  }
  return steps;
}
