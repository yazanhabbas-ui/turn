import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArabicUnits,
  numberUnits,
  primaryKeys,
  resolveUnits,
  ticketUnits,
  unitsText,
  type SpeechUnit,
} from "@/domain/display/arabic-speech";
import { ARABIC_LATIN_LETTERS, arabicNumberWords } from "@/domain/display/arabic-words";
import { planAnnouncement, withoutDesk } from "@/domain/display/plan";
import { CLIP_LEAD_S, CLIP_TAIL_S, scheduleClips } from "@/features/display/voice/schedule";
import { PackTts } from "@/features/display/voice/providers";

/** Written by hand from the grammar rules, independent of the implementation. */
const WORDS: [number, string][] = [
  [0, "صفر"],
  [1, "واحد"],
  [2, "اثنان"],
  [3, "ثلاثة"],
  [9, "تسعة"],
  [10, "عشرة"],
  [11, "أحد عشر"],
  [12, "اثنا عشر"],
  [13, "ثلاثة عشر"],
  [14, "أربعة عشر"],
  [19, "تسعة عشر"],
  [20, "عشرون"],
  [21, "واحد وعشرون"],
  [22, "اثنان وعشرون"],
  [35, "خمسة وثلاثون"],
  [40, "أربعون"],
  [99, "تسعة وتسعون"],
  [100, "مئة"],
  [101, "مئة وواحد"],
  [105, "مئة وخمسة"],
  [110, "مئة وعشرة"],
  [111, "مئة وأحد عشر"],
  [112, "مئة واثنا عشر"],
  [120, "مئة وعشرون"],
  [121, "مئة وواحد وعشرون"],
  [200, "مئتان"],
  [201, "مئتان وواحد"],
  [300, "ثلاثمئة"],
  [456, "أربعمئة وستة وخمسون"],
  [500, "خمسمئة"],
  [900, "تسعمئة"],
  [999, "تسعمئة وتسعة وتسعون"],
  [1000, "ألف"],
  [1001, "ألف وواحد"],
  [2000, "ألفان"],
  [3500, "ثلاثة آلاف وخمسمئة"],
];

describe("Arabic number words", () => {
  it.each(WORDS)("%i is read as %s", (n, words) => {
    expect(arabicNumberWords(n)).toBe(words);
  });

  it("gives every number 0..999 a distinct reading", () => {
    const all = new Set(Array.from({ length: 1000 }, (_, n) => arabicNumberWords(n)));
    expect(all.size).toBe(1000);
  });
});

describe("Arabic ticket units", () => {
  it("reads letter then number as a real number: B-014 desk 3", () => {
    const units = buildArabicUnits({ ticket: "B-014", desk: "3" });
    expect(unitsText(units)).toBe("رقم بي، أربعة عشر، تفضل إلى المكتب ثلاثة");
    expect(primaryKeys(units)).toEqual(["ar.phrase.number", "ar.letter.B", "ar.num.14", "ar.phrase.desk", "ar.num.3"]);
    // Where the deliberate pauses go.
    expect(units.map((u) => u.gap)).toEqual([null, "phrase", "letter", "desk", "inner"]);
  });

  it("supports number only and digit by digit", () => {
    expect(unitsText(buildArabicUnits({ ticket: "B-014", desk: null, reading: "number_only" }))).toBe("رقم أربعة عشر");
    expect(primaryKeys(buildArabicUnits({ ticket: "B-014", desk: null, reading: "digits" }))).toEqual([
      "ar.phrase.number",
      "ar.letter.B",
      "ar.digit.1",
      "ar.digit.4",
    ]);
    // Leading zeros are dropped in every reading (A-014 is 14).
    expect(primaryKeys(ticketUnits("A-014", "digits", null))).toEqual(["ar.letter.A", "ar.digit.1", "ar.digit.4"]);
  });

  it("handles Eastern digits, Arabic letters, several letters and long numbers", () => {
    expect(primaryKeys(buildArabicUnits({ ticket: "أ-٠١٤", desk: "٣" }))).toEqual([
      "ar.phrase.number",
      "ar.letter.أ",
      "ar.num.14",
      "ar.phrase.desk",
      "ar.num.3",
    ]);
    expect(primaryKeys(buildArabicUnits({ ticket: "GA-105", desk: null }))).toEqual([
      "ar.phrase.number",
      "ar.letter.G",
      "ar.letter.A",
      "ar.num.105",
    ]);
    // 1234 = thousand clip + remainder clip.
    const long = numberUnits(1234, "phrase");
    expect(unitsText(long)).toBe("ألف ومئتان وأربعة وثلاثون");
    expect(resolveUnits(long, (k) => ["ar.num.1000", "ar.num.234"].includes(k))?.map((c) => c.key)).toEqual([
      "ar.num.1000",
      "ar.num.234",
    ]);
    expect(numberUnits(20000, "phrase")[0].alternatives?.[0].map((u) => u.key)).toEqual(["ar.num.20", "ar.word.thousand"]);
  });

  it("omits the desk when asked, and reads nothing for a ticket without a number", () => {
    expect(primaryKeys(buildArabicUnits({ ticket: "B-014", desk: "3", includeDesk: false }))).toEqual([
      "ar.phrase.number",
      "ar.letter.B",
      "ar.num.14",
    ]);
    expect(buildArabicUnits({ ticket: "VIP", desk: "3" })).toEqual([]);
  });
});

describe("falling back when a pack has no whole-number clip", () => {
  const has = (keys: string[]) => (k: string) => keys.includes(k);
  const digits = Array.from({ length: 10 }, (_, d) => `ar.digit.${d}`);

  it("builds a number from hundreds, ones and tens, and moves the pause to the first piece", () => {
    const minimal = has(["ar.num.100", "ar.num.5", "ar.num.40", ...digits]);
    const units = numberUnits(145, "letter");
    expect(resolveUnits(units, minimal)).toEqual([
      { key: "ar.num.100", gap: "letter" },
      { key: "ar.num.5", gap: "inner" },
      { key: "ar.num.40", gap: "inner" },
    ]);
  });

  it("uses the whole-number clip when it exists", () => {
    expect(resolveUnits(numberUnits(145, "letter"), has(["ar.num.145", "ar.num.100"]))).toEqual([
      { key: "ar.num.145", gap: "letter" },
    ]);
  });

  it("reads digit by digit for an old pack that only has digits", () => {
    const units = buildArabicUnits({ ticket: "A-014", desk: "3" });
    const old = has(["ar.phrase.number", "ar.phrase.desk", "ar.letter.A", ...digits]);
    expect(resolveUnits(units, old)?.map((c) => c.key)).toEqual([
      "ar.phrase.number",
      "ar.letter.A",
      "ar.digit.1",
      "ar.digit.4",
      "ar.phrase.desk",
      "ar.digit.3",
    ]);
  });

  it("cannot be played when even the digits are missing", () => {
    const units: SpeechUnit[] = numberUnits(14, "phrase");
    expect(resolveUnits(units, has(["ar.digit.1"]))).toBeNull();
    const pack = new PackTts({ ar: { "ar.phrase.number": "/x.mp3" } });
    expect(pack.supports({ locale: "ar", text: "", keys: [], units: buildArabicUnits({ ticket: "A-1", desk: null }) })).toBe(
      false,
    );
    expect(pack.supports({ locale: "en", text: "", keys: [] })).toBe(false);
  });
});

describe("scheduling the clips", () => {
  const timing = { gapPhraseMs: 200, gapLetterNumberMs: 100, gapDeskMs: 400, overlapMs: 0 };
  it("puts the configured pause between the speech of two clips and none at the very start", () => {
    const { starts, total } = scheduleClips(
      [
        { gap: null, duration: 0.5 },
        { gap: "phrase", duration: 0.5 },
        { gap: "desk", duration: 1 },
      ],
      timing,
    );
    expect(starts[0]).toBe(0);
    // the clips fixed padding is inside the configured gap
    expect(starts[1]).toBeCloseTo(0.5 - CLIP_TAIL_S + 0.2 - CLIP_LEAD_S, 5);
    expect(starts[2]).toBeCloseTo(starts[1] + 0.5 - CLIP_TAIL_S + 0.4 - CLIP_LEAD_S, 5);
    expect(total).toBeCloseTo(starts[2] + 1, 5);
  });

  it("overlaps only pieces of one number, and shortens the clips at a higher speed", () => {
    const clips = [
      { gap: null, duration: 1 },
      { gap: "inner" as const, duration: 1 },
    ];
    const plain = scheduleClips(clips, timing);
    const overlapped = scheduleClips(clips, { ...timing, overlapMs: 40 });
    expect(overlapped.starts[1]).toBeCloseTo(plain.starts[1] - 0.04, 5);
    expect(scheduleClips(clips, timing, 1.25).total).toBeLessThan(plain.total);
    // A start never goes back before the previous clip started.
    expect(scheduleClips(clips, { ...timing, overlapMs: 120 }).starts[1]).toBeGreaterThanOrEqual(0);
  });
});

describe("planning the call in Arabic", () => {
  const templates = {
    ticket_called: { ar: "رقم {ticket}، الرجاء التوجه إلى المكتب {desk}", en: "Number {ticket}, please go to desk {desk}" },
  };
  const base = {
    templates,
    event: "ticket_called" as const,
    displayNumber: "B-014",
    deskNumber: "3",
    ticketLanguage: "ar",
    digits: "latn" as const,
  };
  const settings = { callLanguages: "ar" as const, ticketReading: "letter_then_number" as const, announceDesk: true };

  it("speaks Arabic numbers as words for the browser voice too", () => {
    const [step] = planAnnouncement({ ...base, settings });
    expect(step.text).toBe("رقم بي أربعة عشر، الرجاء التوجه إلى المكتب ثلاثة");
    expect(step.units?.length).toBeGreaterThan(0);
  });

  it("applies the reading and the desk switch", () => {
    const [noDesk] = planAnnouncement({ ...base, settings: { ...settings, announceDesk: false, ticketReading: "number_only" } });
    expect(noDesk.text).toBe("رقم أربعة عشر");
    expect(primaryKeys(noDesk.units ?? [])).toEqual(["ar.phrase.number", "ar.num.14"]);
    const [en] = planAnnouncement({ ...base, settings: { ...settings, callLanguages: "en", ticketReading: "number_only" } });
    expect(en.text).toBe("Number 14, please go to desk 3");
  });

  it("removes the desk clause from a template, or keeps only the ticket", () => {
    expect(withoutDesk("رقم {ticket}، الرجاء التوجه إلى المكتب {desk}")).toBe("رقم {ticket}");
    expect(withoutDesk("Ticket {ticket} to desk {desk}")).toBe("{ticket}");
  });
});

describe("the bundled Arabic packs", () => {
  const root = path.join(process.cwd(), "public", "audio", "ar");
  const packs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "manifest.json")))
    .map((d) => ({
      id: d.name,
      manifest: JSON.parse(fs.readFileSync(path.join(root, d.name, "manifest.json"), "utf8")) as Record<string, string>,
    }));

  it("has at least one pack", () => expect(packs.length).toBeGreaterThan(0));

  for (const { id, manifest } of packs) {
    it(`${id}: every manifest file exists and every call can be composed`, () => {
      for (const url of Object.values(manifest)) expect(fs.existsSync(path.join(process.cwd(), "public", url)), url).toBe(true);
      const has = (k: string) => !!manifest[k];
      // Every letter A-Z and the phrases.
      for (const ch of Object.keys(ARABIC_LATIN_LETTERS)) expect(has(`ar.letter.${ch}`), ch).toBe(true);
      expect(has("ar.phrase.number") && has("ar.phrase.desk")).toBe(true);
      if (!has("ar.num.999")) {
        // A "core" pack: every number must still be composable from its pieces (0..100, hundreds).
        if (has("ar.num.100"))
          for (let n = 1; n <= 999; n++)
            expect(resolveUnits(buildArabicUnits({ ticket: `Z-${n}`, desk: String(n) }), has), `${n}`).not.toBeNull();
        return;
      }
      for (let n = 1; n <= 999; n++) {
        expect(has(`ar.num.${n}`), `ar.num.${n}`).toBe(true);
        const clips = resolveUnits(buildArabicUnits({ ticket: `Z-${n}`, desk: String(n) }), has);
        // Whole-number clips only: no fallback needed anywhere.
        expect(clips?.map((c) => c.key)).toEqual([
          "ar.phrase.number",
          "ar.letter.Z",
          `ar.num.${n}`,
          "ar.phrase.desk",
          `ar.num.${n}`,
        ]);
      }
    });
  }
});
