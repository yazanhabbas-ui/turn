import { renderTemplate } from "../templates/render";
import { catalogEntry, type PageGroup } from "./catalog";

/** Overridden texts of one page: only the ids an administrator changed, per language. */
export type TextOverrides = Record<string, { ar?: string; en?: string }>;
export type TextVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** Removes what must never be shown as markup or hidden control: tags, control characters and bidi overrides. */
export function cleanText(input: string, multiline = false): string {
  let s = input
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "")
    // Control characters (keeping a newline when allowed) and bidi override/isolate characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "");
  s = multiline
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    : s.replace(/\s+/g, " ");
  return s.trim();
}

/** The override for an id in a language, or "" when there is none. */
export function overrideOf(overrides: TextOverrides | null | undefined, id: string, lang: string): string {
  const own = overrides && Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : undefined;
  const v = own?.[lang === "en" ? "en" : "ar"];
  return typeof v === "string" ? v : "";
}

/**
 * The text to show: the administrator's override in this language when there is one, else the default from the message
 * files (`fallback`). Placeholders are filled from `vars`; a placeholder without a value stays visible.
 */
export function resolveText(
  overrides: TextOverrides | null | undefined,
  id: string,
  lang: string,
  vars: TextVars,
  fallback: (id: string, vars: TextVars) => string,
): string {
  const own = overrideOf(overrides, id, lang);
  return own ? renderTemplate(own, vars) : fallback(id, vars);
}

/** The `{name}` placeholders of a text. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

export type TextIssue = "unknown_key" | "too_long" | "unknown_placeholder" | "stray_brace";

/**
 * Checks one text against its catalogue entry: it must be a known id, within its length cap, use only the
 * placeholders that id allows and contain no other braces.
 */
export function textIssue(group: PageGroup, id: string, text: string): { issue: TextIssue; detail?: string } | null {
  const entry = catalogEntry(group, id);
  if (!entry) return { issue: "unknown_key" };
  if (text.length > entry.max) return { issue: "too_long", detail: String(entry.max) };
  const used = placeholdersIn(text);
  const bad = used.find((p) => !entry.placeholders.includes(p));
  if (bad) return { issue: "unknown_placeholder", detail: bad };
  if (/[{}]/.test(text.replace(PLACEHOLDER, ""))) return { issue: "stray_brace" };
  return null;
}
