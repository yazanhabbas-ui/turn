import { describe, expect, it } from "vitest";
import { primaryKeys, resolveUnits } from "@/domain/display/arabic-speech";
import { ARABIC_HALL_PHRASE_KEYS, ARABIC_PHRASES } from "@/domain/display/arabic-words";
import {
  buildHallArabicUnits,
  hallEnglishText,
  missingHallPhraseKeys,
  planHallAnnouncement,
  requiredHallPhraseKeys,
  type HallCall,
} from "@/domain/display/hall-speech";
import { unitsText } from "@/domain/display/arabic-speech";
import { planGroupAnnouncement } from "@/domain/halls/announce";
import { PackTts } from "@/features/display/voice/providers";

const call = (displayNumbers: string[], over: Partial<HallCall> = {}): HallCall => ({
  displayNumbers,
  hallNumber: "2",
  announce: { mode: "list", maxAnnounced: 6 },
  reading: "letter_then_number",
  ...over,
});
const text = (c: HallCall) => unitsText(buildHallArabicUnits(c));

describe("group call in Arabic", () => {
  it("reads a list: الأرقام, each ticket, و before the last, then the hall", () => {
    expect(text(call(["B-014", "B-015", "B-016"]))).toBe(
      "الأرقام بي، أربعة عشر، بي، خمسة عشر، و بي، ستة عشر، تفضلوا إلى القاعة اثنان",
    );
  });

  it("reads one visitor as a single call with the singular phrase", () => {
    expect(text(call(["B-014"]))).toBe("رقم بي، أربعة عشر، تفضل إلى القاعة اثنان");
  });

  it("reads consecutive tickets over the limit as a range", () => {
    const c = call(["A-001", "A-002", "A-003", "A-004"], { announce: { mode: "list", maxAnnounced: 3 } });
    expect(text(c)).toBe("الأرقام من إيه، واحد، إلى إيه، أربعة، تفضلوا إلى القاعة اثنان");
    expect(text(call(["A-010", "A-011", "A-012"], { announce: { mode: "range", maxAnnounced: 6 } }))).toContain("من إيه");
  });

  it("falls back to the next group when even the ranges are too many", () => {
    const c = call(["A-001", "A-003", "A-005", "A-007"], { announce: { mode: "list", maxAnnounced: 2 } });
    expect(text(c)).toBe("المجموعة التالية، تفضلوا إلى القاعة اثنان");
  });

  it("hall_only never reads numbers", () => {
    const c = call(["A-001", "A-002"], { announce: { mode: "hall_only", maxAnnounced: 6 } });
    expect(text(c)).toBe("المجموعة التالية، تفضلوا إلى القاعة اثنان");
  });

  it("speaks the hall number in words, whatever the digits on screen (Eastern digits included)", () => {
    expect(text(call(["A-001", "A-002"], { hallNumber: "٢" }))).toMatch(/القاعة اثنان$/);
    expect(text(call(["A-001", "A-002"], { hallNumber: "12" }))).toMatch(/القاعة اثنا عشر$/);
    expect(text(call(["أ-٠١٤", "أ-٠١٥"]))).toContain("ألف، أربعة عشر");
  });

  it("reuses the single-ticket clips: ticket number clips and phrase keys", () => {
    const keys = primaryKeys(buildHallArabicUnits(call(["B-014", "B-015"])));
    expect(keys).toEqual([
      "ar.phrase.group_numbers",
      "ar.letter.B",
      "ar.num.14",
      "ar.phrase.and",
      "ar.letter.B",
      "ar.num.15",
      "ar.phrase.please_go_to_hall",
      "ar.num.2",
    ]);
  });
});

describe("required clips", () => {
  it("lists the phrase keys each kind of group call needs", () => {
    const list = planGroupAnnouncement(["A-001", "A-005", "A-009"], "list", 6);
    expect(requiredHallPhraseKeys(list).sort()).toEqual([
      "ar.phrase.and",
      "ar.phrase.group_numbers",
      "ar.phrase.please_go_to_hall",
    ]);
    const range = planGroupAnnouncement(["A-001", "A-002", "A-003", "A-004"], "range", 6);
    expect(requiredHallPhraseKeys(range)).toEqual(
      expect.arrayContaining(["ar.phrase.range_from", "ar.phrase.range_to", "ar.phrase.group_numbers"]),
    );
    expect(requiredHallPhraseKeys(planGroupAnnouncement(["A-001"], "list", 6)).sort()).toEqual([
      "ar.phrase.number",
      "ar.phrase.please_go_to_hall_single",
    ]);
    expect(requiredHallPhraseKeys(planGroupAnnouncement(["A-001", "A-002"], "hall_only", 6)).sort()).toEqual([
      "ar.phrase.next_group",
      "ar.phrase.please_go_to_hall",
    ]);
  });

  it("reports what a pack lacks", () => {
    const old = { "ar.phrase.number": "/n.mp3", "ar.phrase.desk": "/d.mp3" };
    expect(missingHallPhraseKeys(old)).toHaveLength(ARABIC_HALL_PHRASE_KEYS.length);
    const full = Object.fromEntries(ARABIC_HALL_PHRASE_KEYS.map((k) => [`ar.phrase.${k}`, "/x.mp3"]));
    expect(missingHallPhraseKeys(full)).toEqual([]);
    expect(Object.keys(ARABIC_PHRASES)).toEqual(expect.arrayContaining([...ARABIC_HALL_PHRASE_KEYS]));
  });

  it("a pack without the group phrases cannot play the step, so the browser voice takes over", () => {
    const manifest: Record<string, string> = { "ar.phrase.number": "/n.mp3" };
    for (let n = 0; n <= 20; n++) manifest[`ar.num.${n}`] = `/${n}.mp3`;
    manifest["ar.letter.B"] = "/b.mp3";
    const steps = planHallAnnouncement({
      settings: { callLanguages: "ar", ticketReading: "letter_then_number" },
      hallNumber: "2",
      displayNumbers: ["B-014", "B-015"],
      announce: { mode: "list", maxAnnounced: 6 },
      ticketLanguage: "ar",
      digits: "latn",
    });
    const has = (k: string) => !!manifest[k];
    expect(resolveUnits(steps[0].units!, has)).toBeNull();
    expect(new PackTts({ ar: manifest }).plan(steps[0])).toBeNull();
    const complete = { ...manifest, ...Object.fromEntries(ARABIC_HALL_PHRASE_KEYS.map((k) => [`ar.phrase.${k}`, "/p.mp3"])) };
    expect(new PackTts({ ar: complete }).plan(steps[0])).not.toBeNull();
    // The step still carries Arabic words for the browser voice.
    expect(steps[0].text).toContain("تفضلوا إلى القاعة اثنان");
  });
});

describe("group call in English and across languages", () => {
  it("composes the English text", () => {
    expect(hallEnglishText(call(["A-014", "A-015", "A-016"]), "latn")).toBe("Tickets A 14, A 15 and A 16, please go to hall 2");
    expect(hallEnglishText(call(["A-014"]), "latn")).toBe("Ticket A 14, please go to hall 2");
    expect(
      hallEnglishText(call(["A-001", "A-002", "A-003", "A-004"], { announce: { mode: "range", maxAnnounced: 6 } }), "latn"),
    ).toBe("Tickets from A 1 to A 4, please go to hall 2");
    expect(hallEnglishText(call(["A-001", "A-002"], { announce: { mode: "hall_only", maxAnnounced: 6 } }), "latn")).toBe(
      "The next group, please go to hall 2",
    );
    expect(hallEnglishText(call(["A-014"], { hallNumber: "2" }), "arab")).toBe("Ticket A ١٤, please go to hall ٢");
  });

  it("plans one step per language following callLanguages", () => {
    const base = {
      settings: { callLanguages: "both_en_ar" as const, ticketReading: "letter_then_number" as const },
      hallNumber: "2",
      displayNumbers: ["A-014", "A-015"],
      announce: { mode: "list" as const, maxAnnounced: 6 },
      ticketLanguage: "en",
      digits: "latn" as const,
    };
    const steps = planHallAnnouncement(base);
    expect(steps.map((s) => s.locale)).toEqual(["en", "ar"]);
    expect(steps[0].text).toBe("Tickets A 14 and A 15, please go to hall 2");
    expect(steps[1].units?.length).toBeGreaterThan(0);
    expect(
      planHallAnnouncement({ ...base, settings: { ...base.settings, callLanguages: "ticket" } }).map((s) => s.locale),
    ).toEqual(["en"]);
    expect(planHallAnnouncement({ ...base, settings: { ...base.settings, callLanguages: "ar" } }).map((s) => s.locale)).toEqual([
      "ar",
    ]);
    expect(planHallAnnouncement({ ...base, displayNumbers: [] })).toEqual([]);
  });
});
