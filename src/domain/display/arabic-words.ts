/**
 * Arabic words for ticket announcements. This file has NO imports on purpose: the clip generator
 * (scripts/build-arabic-voice-clips.mjs) loads it directly with Node, so the recorded clips and the composer in
 * arabic-speech.ts always use the very same words.
 *
 * Numbers follow the masculine rule that applies after "رقم" (number) and "المكتب" (the desk, masculine noun):
 * 3 = ثلاثة, 13 = ثلاثة عشر, 2 = اثنان, 12 = اثنا عشر, 200 = مئتان (nominative forms, as read on a call).
 */

/** 0..19, masculine. */
export const ARABIC_UNITS: readonly string[] = [
  "صفر",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];

/** 20, 30 … 90 (index = tens digit). */
export const ARABIC_TENS: readonly string[] = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];

/** 100, 200 … 900 (index = hundreds digit). */
export const ARABIC_HUNDREDS: readonly string[] = [
  "",
  "مئة",
  "مئتان",
  "ثلاثمئة",
  "أربعمئة",
  "خمسمئة",
  "ستمئة",
  "سبعمئة",
  "ثمانمئة",
  "تسعمئة",
];

export const ARABIC_AND = "و";

/** 1000, 2000 … 10000 as one spoken word group. */
export const ARABIC_THOUSANDS: Readonly<Record<number, string>> = {
  1: "ألف",
  2: "ألفان",
  3: "ثلاثة آلاف",
  4: "أربعة آلاف",
  5: "خمسة آلاف",
  6: "ستة آلاف",
  7: "سبعة آلاف",
  8: "ثمانية آلاف",
  9: "تسعة آلاف",
  10: "عشرة آلاف",
};
/** "thousand" after a count of 11 or more ("أحد عشر ألفًا" is written; spoken it is just "ألف"). */
export const ARABIC_THOUSAND = "ألف";

/** Fixed sentence parts. The recorded packs speak exactly these words (the browser voice uses the editable template). */
export const ARABIC_PHRASES = {
  number: "رقم",
  desk: "تفضل إلى المكتب",
  // Group calls to a hall (D62). Clip keys are `ar.phrase.<key>`; a pack without them falls back to the browser voice.
  group_numbers: "الأرقام",
  please_go_to_hall: "تفضلوا إلى القاعة",
  please_go_to_hall_single: "تفضل إلى القاعة",
  and: "و",
  next_group: "المجموعة التالية",
  range_from: "من",
  range_to: "إلى",
} as const;

/** The phrases added for halls, in the order the clip generator builds them. */
export const ARABIC_HALL_PHRASE_KEYS = [
  "group_numbers",
  "please_go_to_hall",
  "please_go_to_hall_single",
  "and",
  "next_group",
  "range_from",
  "range_to",
] as const;

/** How an Arabic speaker names the Latin letters of a ticket prefix. */
export const ARABIC_LATIN_LETTERS: Readonly<Record<string, string>> = {
  A: "إيه",
  B: "بي",
  C: "سي",
  D: "دي",
  E: "إي",
  F: "إف",
  G: "جي",
  H: "إتش",
  I: "آي",
  J: "جيه",
  K: "كي",
  L: "إل",
  M: "إم",
  N: "إن",
  O: "أو",
  P: "بيه",
  Q: "كيو",
  R: "آر",
  S: "إس",
  T: "تي",
  U: "يو",
  V: "في",
  W: "دبليو",
  X: "إكس",
  Y: "واي",
  Z: "زد",
};

/** Names of the Arabic letters (a ticket prefix may be an Arabic letter). */
export const ARABIC_LETTER_NAMES: Readonly<Record<string, string>> = {
  أ: "ألف",
  ب: "باء",
  ت: "تاء",
  ث: "ثاء",
  ج: "جيم",
  ح: "حاء",
  خ: "خاء",
  د: "دال",
  ذ: "ذال",
  ر: "راء",
  ز: "زاي",
  س: "سين",
  ش: "شين",
  ص: "صاد",
  ض: "ضاد",
  ط: "طاء",
  ظ: "ظاء",
  ع: "عين",
  غ: "غين",
  ف: "فاء",
  ق: "قاف",
  ك: "كاف",
  ل: "لام",
  م: "ميم",
  ن: "نون",
  ه: "هاء",
  و: "واو",
  ي: "ياء",
};

/** Largest number read as Arabic words; anything above is read digit by digit. */
export const ARABIC_MAX_NUMBER = 999_999;

/** 1..999 as words ("مئة وخمسة", "تسعمئة وتسعة وتسعون"). 0 = "صفر". */
export function arabicWordsBelowThousand(n: number): string {
  if (n === 0) return ARABIC_UNITS[0];
  const parts: string[] = [];
  const rest = n % 100;
  if (n >= 100) parts.push(ARABIC_HUNDREDS[Math.floor(n / 100)]);
  if (rest > 0 && rest < 20) parts.push(ARABIC_UNITS[rest]);
  else if (rest >= 20) {
    // Units come first: "خمسة وأربعون".
    if (rest % 10) parts.push(ARABIC_UNITS[rest % 10]);
    parts.push(ARABIC_TENS[Math.floor(rest / 10)]);
  }
  // "و" is written attached to the following word: "مئة وخمسة".
  return parts.map((p, i) => (i === 0 ? p : ARABIC_AND + p)).join(" ");
}

/** Any whole number up to 999 999 as Arabic words; thousands are "ألف", "ألفان", "ثلاثة آلاف"… */
export function arabicNumberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > ARABIC_MAX_NUMBER) return "";
  if (n < 1000) return arabicWordsBelowThousand(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands <= 10 ? ARABIC_THOUSANDS[thousands] : `${arabicWordsBelowThousand(thousands)} ${ARABIC_THOUSAND}`;
  return rest ? `${head} ${ARABIC_AND}${arabicWordsBelowThousand(rest)}` : head;
}
