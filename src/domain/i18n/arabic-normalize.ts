import { toWesternDigits } from "./digits";

// Harakat, tanween, shadda, sukun, superscript alef, Quranic marks, and tatweel.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * Folds Arabic spelling variants so searches match regardless of how a name was typed:
 * أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, Persian ک/ی → ك/ي, diacritics and tatweel removed,
 * Latin lower-cased, digits made Western, whitespace collapsed.
 */
export function normalizeArabic(input: string): string {
  return toWesternDigits(input)
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/[یې]/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{Nd}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Loose cross-script matching. Both Arabic and Latin spellings are reduced to a consonant "skeleton"
 * so that محمد, Mohammed, Muhammad and Mohamed all become "mhmd". Vowels, weak letters (ا و ي ع ء) and
 * doubled letters are dropped; phonetically close letters share one class.
 */
const AR_SKELETON: Record<string, string> = {
  ب: "b",
  ت: "t",
  ث: "t",
  ج: "j",
  ح: "h",
  خ: "k",
  د: "d",
  ذ: "d",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "s",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  غ: "g",
  ف: "f",
  ق: "k",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  گ: "g",
  پ: "b",
  چ: "j",
  ژ: "z",
};

const LATIN_DIGRAPHS: [RegExp, string][] = [
  [/kh/g, "k"],
  [/gh/g, "G"],
  [/sh/g, "s"],
  [/th/g, "t"],
  [/dh/g, "d"],
  [/ch/g, "j"],
  [/ph/g, "f"],
];

const LATIN_SINGLE: Record<string, string> = {
  q: "k",
  c: "k",
  g: "j",
  G: "g",
  p: "b",
  v: "f",
  x: "ks",
};

function collapse(s: string): string {
  return s.replace(/(.)\1+/g, "$1").replace(/h$/, "");
}

function skeletonWord(word: string): string {
  if (/[؀-ۿ]/.test(word)) {
    // Final taa marbuta is normally silent (فاطمة ≈ Fatima); it was folded to ه by normalizeArabic.
    const w = word.replace(/ه$/, "");
    let out = "";
    for (const ch of w) out += AR_SKELETON[ch] ?? "";
    return collapse(out);
  }
  let w = word.toLowerCase();
  for (const [re, rep] of LATIN_DIGRAPHS) w = w.replace(re, rep);
  let out = "";
  for (const ch of w) {
    if ("aeiouyw'`".includes(ch)) continue;
    if (/[a-zG]/.test(ch)) out += LATIN_SINGLE[ch] ?? ch;
  }
  return collapse(out);
}

/** Space-separated consonant skeleton of every word; "ال"/"al" articles are removed. */
export function nameSkeleton(input: string): string {
  return normalizeArabic(input)
    .split(" ")
    .map((w) => w.replace(/^(ال|al-?|el-?)(?=.{2,})/, ""))
    .map(skeletonWord)
    .filter(Boolean)
    .join(" ");
}

/**
 * True when every word of the query matches the start of some word of the name, either after
 * Arabic normalization or by consonant skeleton (cross-script).
 */
export function looseNameMatch(name: string, query: string): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  const n = normalizeArabic(name);
  if (n.includes(q)) return true;
  const nameWords = nameSkeleton(name).split(" ");
  const queryWords = nameSkeleton(query).split(" ").filter(Boolean);
  if (queryWords.length === 0) return false;
  return queryWords.every((qw) => nameWords.some((nw) => nw.startsWith(qw)));
}
