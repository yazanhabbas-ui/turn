import { describe, expect, it } from "vitest";
import { looseNameMatch, nameSkeleton, normalizeArabic } from "@/domain/i18n/arabic-normalize";

describe("normalizeArabic", () => {
  it("folds alef, yaa and taa marbuta variants", () => {
    expect(normalizeArabic("أحمد")).toBe(normalizeArabic("احمد"));
    expect(normalizeArabic("إيمان")).toBe("ايمان");
    expect(normalizeArabic("آمنة")).toBe("امنه");
    expect(normalizeArabic("مصطفى")).toBe("مصطفي");
    expect(normalizeArabic("فاطمة")).toBe(normalizeArabic("فاطمه"));
  });

  it("strips diacritics and tatweel", () => {
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("مـحـمـد")).toBe("محمد");
  });

  it("converts Eastern digits and collapses whitespace", () => {
    expect(normalizeArabic("  غرفة   ٣ ")).toBe("غرفه 3");
  });
});

describe("loose cross-script matching", () => {
  it.each([
    ["محمد", "Mohammed"],
    ["محمد", "Muhammad"],
    ["محمد", "Mohamed"],
    ["أحمد", "Ahmed"],
    ["عبدالله", "Abdullah"],
    ["فاطمة", "Fatima"],
    ["خالد العتيبي", "Khalid Otaibi"],
    ["يوسف", "Yousef"],
    ["قاسم", "Kasim"],
  ])("%s matches %s", (arabic, latin) => {
    expect(nameSkeleton(arabic)).toBe(nameSkeleton(latin));
    expect(looseNameMatch(arabic, latin)).toBe(true);
    expect(looseNameMatch(latin, arabic)).toBe(true);
  });

  it("matches prefixes of words and variant spellings in the same script", () => {
    expect(looseNameMatch("خالد بن سعيد", "خال")).toBe(true);
    expect(looseNameMatch("أسامة", "اسامه")).toBe(true);
    expect(looseNameMatch("Sara Ahmed", "ahm")).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(looseNameMatch("محمد", "Sara")).toBe(false);
    expect(looseNameMatch("خالد", "نورة")).toBe(false);
  });
});
