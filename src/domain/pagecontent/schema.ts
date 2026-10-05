import { z } from "zod";
import { isRetired, type PageGroup } from "./catalog";
import { cleanText, textIssue, type TextOverrides } from "./text";
import { isSafeHttpsUrl, URL_MAX_LENGTH } from "./url";

export { isSafeHttpsUrl };

/** Longest own text of the free fields (footer); catalogue texts have their own cap. */
const FREE_TEXT_MAX = 300;
const LABEL_MAX = 60;

/** A text per language with plain-text cleaning (no markup) and empty languages dropped. */
function pair(max: number, multiline = false) {
  return z
    .object({
      ar: z
        .string()
        .max(max * 2)
        .optional(),
      en: z
        .string()
        .max(max * 2)
        .optional(),
    })
    .transform((p) => {
      const out: { ar?: string; en?: string } = {};
      for (const lang of ["ar", "en"] as const) {
        const v = cleanText(p[lang] ?? "", multiline);
        if (v) out[lang] = v;
      }
      return out;
    })
    .refine((p) => (p.ar?.length ?? 0) <= max && (p.en?.length ?? 0) <= max, { message: "too_long" });
}

/** Only the changed texts, cleaned: `{ id: { ar?, en? } }`. Validation against the catalogue happens per group. */
function texts(group: PageGroup) {
  return z.record(z.string().max(60), z.record(z.string(), z.string().max(2000))).transform((raw) => {
    const out: TextOverrides = {};
    for (const [id, byLang] of Object.entries(raw)) {
      if (id === "__proto__" || isRetired(group, id)) continue;
      const p: { ar?: string; en?: string } = {};
      for (const lang of ["ar", "en"] as const) {
        const v = cleanText(byLang[lang] ?? "");
        if (v) p[lang] = v;
      }
      if (p.ar || p.en) out[id] = p;
    }
    return out;
  });
}

function checkTexts(group: PageGroup, value: TextOverrides, ctx: z.RefinementCtx) {
  for (const [id, p] of Object.entries(value)) {
    for (const lang of ["ar", "en"] as const) {
      const v = p[lang];
      if (!v) continue;
      const issue = textIssue(group, id, v);
      if (issue)
        ctx.addIssue({
          code: "custom",
          path: ["texts", id, lang],
          message: issue.detail ? `${issue.issue}:${issue.detail}` : issue.issue,
        });
    }
  }
}

const customLink = z.object({
  label: pair(LABEL_MAX).refine((l) => !!(l.ar || l.en), { message: "label_required" }),
  url: z.string().trim().max(URL_MAX_LENGTH).refine(isSafeHttpsUrl, { message: "url_https_only" }),
});

/** The setting `pageContent` (D66): wording and options of the kiosk and of the visitor's status page. */
export const pageContentSchema = z
  .object({
    kiosk: z
      .object({
        texts: texts("kiosk").default({}),
        showBranchName: z.boolean().default(true),
        showLogo: z.boolean().default(true),
        showLanguageButtons: z.boolean().default(true),
        /** brand = the organization's colour band; plain = a quiet header in the screen's own colours. */
        headerStyle: z.enum(["brand", "plain"]).default("brand"),
        /** Service tiles per row on a wide (landscape) screen. A portrait screen always shows one column. */
        tilesPerRowLandscape: z.number().int().min(1).max(4).default(3),
        /** Show a service's description under its name. */
        showReasonDescriptions: z.boolean().default(false),
        /** ticket = the ticket-style card; simple = the number and the QR without the card. */
        successStyle: z.enum(["ticket", "simple"]).default("ticket"),
      })
      .superRefine((v, ctx) => checkTexts("kiosk", v.texts, ctx))
      .prefault({}),
    visitor: z
      .object({
        texts: texts("visitor").default({}),
        showBranch: z.boolean().default(true),
        showQueuePosition: z.boolean().default(true),
        /** Also needs the waiting-time setting to show the estimate on tickets. */
        showEstimatedWait: z.boolean().default(true),
        /** Show the desk or hall in the call card. */
        showDeskCard: z.boolean().default(true),
        showLogo: z.boolean().default(true),
        /** The free Wi-Fi block (when Wi-Fi is on for the branch). */
        showWifi: z.boolean().default(false),
        footerText: pair(FREE_TEXT_MAX, true).default({}),
        supportPhone: z
          .string()
          .trim()
          .max(30)
          .regex(/^(\+?[0-9][0-9 ()\-]{3,28})?$/, { message: "phone_format" })
          .default(""),
        supportEmail: z.union([z.literal(""), z.string().trim().max(120).pipe(z.email())]).default(""),
        customLinks: z.array(customLink).max(3).default([]),
        hideNotifyOptIn: z.boolean().default(false),
      })
      .superRefine((v, ctx) => checkTexts("visitor", v.texts, ctx))
      .prefault({}),
  })
  .prefault({});

export type PageContent = z.infer<typeof pageContentSchema>;
export type KioskPageContent = PageContent["kiosk"];
export type VisitorPageContent = PageContent["visitor"];

/** Every option at its default and no overridden text: what a page uses when nothing is configured. */
export const PAGE_CONTENT_DEFAULTS: PageContent = pageContentSchema.parse({});
