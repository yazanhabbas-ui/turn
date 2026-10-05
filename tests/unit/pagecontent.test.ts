import { describe, expect, it } from "vitest";
import { CATALOG, catalogEntry, catalogOf, NAMESPACE, SCREENS } from "@/domain/pagecontent/catalog";
import { defaultText, messageAt } from "@/domain/pagecontent/defaults";
import { PAGE_CONTENT_DEFAULTS, pageContentSchema } from "@/domain/pagecontent/schema";
import { cleanText, overrideOf, placeholdersIn, resolveText, textIssue } from "@/domain/pagecontent/text";
import { isSafeHttpsUrl } from "@/domain/pagecontent/url";
import { makePageT } from "@/features/pagecontent/make-t";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

const fallback = (id: string, vars: Record<string, unknown>) => `default:${id}:${JSON.stringify(vars)}`;

describe("page content catalogue", () => {
  it("has unique ids per group and a screen that exists", () => {
    for (const group of ["kiosk", "visitor"] as const) {
      const ids = catalogOf(group).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      const screens = SCREENS[group].map((s) => s.id);
      for (const e of catalogOf(group)) expect(screens, `${group}.${e.id}`).toContain(e.screen);
      for (const s of screens)
        expect(
          catalogOf(group).some((e) => e.screen === s),
          s,
        ).toBe(true);
    }
  });

  it("maps every id to a message path that exists in both languages, with a non-empty default", () => {
    for (const e of CATALOG) {
      expect(e.path, e.id).toBe(`${NAMESPACE[e.group]}.${e.id}`);
      for (const lang of ["ar", "en"] as const) {
        expect(messageAt(lang, e.path), `${lang} ${e.path}`).toBeTypeOf("string");
        expect(defaultText(e, lang).trim(), `${lang} ${e.path}`).not.toBe("");
      }
    }
  });

  it("allows every placeholder the default wording uses, and the defaults fit their length cap", () => {
    for (const e of CATALOG) {
      for (const lang of ["ar", "en"] as const) {
        const text = defaultText(e, lang);
        for (const p of placeholdersIn(text)) expect(e.placeholders, `${lang} ${e.path} {${p}}`).toContain(p);
        expect(text.length, `${lang} ${e.path}`).toBeLessThanOrEqual(e.max);
      }
    }
  });

  it("labels and explains every text in both languages, with sane placeholders and caps", () => {
    for (const e of CATALOG) {
      for (const lang of ["ar", "en"] as const) {
        expect(e.label[lang].trim(), `${e.id} label ${lang}`).not.toBe("");
        expect(e.hint[lang].trim(), `${e.id} hint ${lang}`).not.toBe("");
      }
      expect(e.max).toBeGreaterThanOrEqual(10);
      expect(e.max).toBeLessThanOrEqual(300);
      for (const p of e.placeholders) expect(p).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    }
  });

  it("covers the wording the pages need", () => {
    for (const id of ["welcome", "chooseService", "back", "getNumber", "issuing", "yourNumber", "ahead", "youAreNext"])
      expect(catalogEntry("kiosk", id), id).toBeDefined();
    for (const id of ["title", "waiting", "called", "serving", "finished", "noShow", "cancelled", "notFound", "refreshes"])
      expect(catalogEntry("visitor", id), id).toBeDefined();
  });
});

describe("resolving texts", () => {
  it("uses the override of the language, else the default; never another language's override", () => {
    const overrides = { chooseService: { ar: "اختر" } };
    expect(resolveText(overrides, "chooseService", "ar", {}, fallback)).toBe("اختر");
    expect(resolveText(overrides, "chooseService", "en", {}, fallback)).toContain("default:chooseService");
    expect(resolveText(undefined, "chooseService", "ar", {}, fallback)).toContain("default:chooseService");
    expect(overrideOf(overrides, "chooseService", "en")).toBe("");
    expect(overrideOf({}, "constructor", "ar")).toBe("");
  });

  it("fills placeholders and leaves a missing one visible", () => {
    const overrides = { ahead: { en: "{count} before you at {branch} ({unknown})" } };
    expect(resolveText(overrides, "ahead", "en", { count: 3, branch: "Main" }, fallback)).toBe(
      "3 before you at Main ({unknown})",
    );
  });

  it("builds the kiosk's t: override, dictionary, base and call variables", () => {
    const t = makePageT(
      { ahead: "{count} ahead", back: "Back" },
      "en",
      { back: { en: "Return to {branch}" } },
      { branch: "Main" },
    );
    expect(t("back")).toBe("Return to Main");
    expect(t("ahead", { count: 2 })).toBe("2 ahead");
    expect(t("missing")).toBe("missing");
  });

  it("cleans markup, control and bidi-override characters", () => {
    expect(cleanText("<b>Hi</b>  there‮\u0007")).toBe("Hi there");
    expect(cleanText("a\n\n\n\nb", true)).toBe("a\n\nb");
    expect(cleanText("a\nb")).toBe("a b");
  });

  it("checks placeholders and length per id", () => {
    expect(textIssue("kiosk", "ahead", "{count} before you")).toBeNull();
    expect(textIssue("kiosk", "ahead", "{nope}")).toEqual({ issue: "unknown_placeholder", detail: "nope" });
    expect(textIssue("kiosk", "back", "{number}")).toEqual({ issue: "unknown_placeholder", detail: "number" });
    expect(textIssue("kiosk", "ahead", "a { b")).toEqual({ issue: "stray_brace" });
    expect(textIssue("kiosk", "back", "x".repeat(41))).toEqual({ issue: "too_long", detail: "40" });
    expect(textIssue("kiosk", "nothing", "x")).toEqual({ issue: "unknown_key" });
    expect(textIssue("visitor", "nothing", "x")).toEqual({ issue: "unknown_key" });
    expect(textIssue("visitor", "called", "Go to {desk}")).toBeNull();
  });
});

describe("pageContent setting", () => {
  it("defaults to no overridden text and the current look", () => {
    const d = defaultSetting("pageContent");
    expect(d.kiosk).toMatchObject({
      texts: {},
      showBranchName: true,
      showLogo: true,
      showLanguageButtons: true,
      headerStyle: "brand",
      tilesPerRowLandscape: 3,
      showReasonDescriptions: false,
      successStyle: "ticket",
    });
    expect(d.visitor).toMatchObject({
      texts: {},
      showBranch: true,
      showQueuePosition: true,
      showEstimatedWait: true,
      showDeskCard: true,
      showLogo: true,
      showWifi: false,
      footerText: {},
      supportPhone: "",
      supportEmail: "",
      customLinks: [],
      hideNotifyOptIn: false,
    });
    expect(PAGE_CONTENT_DEFAULTS).toEqual(d);
  });

  it("accepts known ids with allowed placeholders and drops empty ones", () => {
    const v = pageContentSchema.parse({
      kiosk: { texts: { ahead: { en: "{count} before you", ar: "   " }, back: { ar: "", en: "" } } },
      visitor: { texts: { called: { ar: "تفضل إلى {desk}" } } },
    });
    expect(v.kiosk.texts).toEqual({ ahead: { en: "{count} before you" } });
    expect(v.visitor.texts).toEqual({ called: { ar: "تفضل إلى {desk}" } });
  });

  it("rejects an unknown id, an unknown placeholder, stray braces and over-long texts", () => {
    const bad = (kiosk: unknown) => pageContentSchema.safeParse({ kiosk }).success;
    expect(bad({ texts: { nothing: { en: "x" } } })).toBe(false);
    expect(bad({ texts: { back: { en: "{count}" } } })).toBe(false);
    expect(bad({ texts: { ahead: { en: "{ count }" } } })).toBe(false);
    expect(bad({ texts: { back: { en: "x".repeat(41) } } })).toBe(false);
    expect(pageContentSchema.safeParse({ visitor: { texts: { title: { en: "{number}" } } } }).success).toBe(false);
  });

  it("stores markup as plain text", () => {
    const v = pageContentSchema.parse({ kiosk: { texts: { back: { en: "<script>alert(1)</script>Go <b>back</b>" } } } });
    expect(v.kiosk.texts.back?.en).toBe("alert(1)Go back");
    expect(v.kiosk.texts.back?.en).not.toMatch(/[<>]/);
  });

  it("checks the structural options", () => {
    const bad = (kiosk: unknown) => pageContentSchema.safeParse({ kiosk }).success;
    expect(bad({ tilesPerRowLandscape: 0 })).toBe(false);
    expect(bad({ tilesPerRowLandscape: 5 })).toBe(false);
    expect(bad({ tilesPerRowLandscape: 2.5 })).toBe(false);
    expect(bad({ tilesPerRowLandscape: 4 })).toBe(true);
    expect(bad({ headerStyle: "wild" })).toBe(false);
    expect(bad({ successStyle: "simple" })).toBe(true);
  });

  it("allows https links only, at most three, with a label", () => {
    const visitor = (customLinks: unknown) => pageContentSchema.safeParse({ visitor: { customLinks } }).success;
    const link = (url: string) => [{ label: { en: "Help" }, url }];
    expect(visitor(link("https://example.com/help"))).toBe(true);
    expect(visitor(link("javascript:alert(1)"))).toBe(false);
    expect(visitor(link("JaVaScRiPt:alert(1)"))).toBe(false);
    expect(visitor(link("http://example.com"))).toBe(false);
    expect(visitor(link("data:text/html,<b>x</b>"))).toBe(false);
    expect(visitor(link("//example.com"))).toBe(false);
    expect(visitor(link("https://user:pw@example.com"))).toBe(false);
    expect(visitor(link("https://exa mple.com"))).toBe(false);
    expect(visitor([{ label: {}, url: "https://example.com" }])).toBe(false);
    expect(visitor([1, 2, 3, 4].map((n) => ({ label: { en: `L${n}` }, url: `https://example.com/${n}` })))).toBe(false);
    expect(visitor([1, 2, 3].map((n) => ({ label: { ar: `ر${n}` }, url: `https://example.com/${n}` })))).toBe(true);
  });

  it("checks the contact lines and cleans the footer", () => {
    const visitor = (v: unknown) => pageContentSchema.safeParse({ visitor: v });
    expect(visitor({ supportPhone: "+963 11 123 4567", supportEmail: "help@example.com" }).success).toBe(true);
    expect(visitor({ supportPhone: "call me" }).success).toBe(false);
    expect(visitor({ supportEmail: "not-an-email" }).success).toBe(false);
    const footer = visitor({ footerText: { en: "Line 1\n<i>Line 2</i>", ar: "" } });
    expect(footer.success && footer.data.visitor.footerText).toEqual({ en: "Line 1\nLine 2" });
    expect(visitor({ footerText: { en: "x".repeat(301) } }).success).toBe(false);
  });

  it("falls back to the defaults for a stored value that is no longer valid", () => {
    expect(parseSetting("pageContent", { kiosk: { texts: { gone: { en: "x" } } } }).kiosk.texts).toEqual({});
  });

  it("knows https urls", () => {
    expect(isSafeHttpsUrl("https://example.com")).toBe(true);
    expect(isSafeHttpsUrl("https://localhost")).toBe(false);
    expect(isSafeHttpsUrl("")).toBe(false);
  });
});
