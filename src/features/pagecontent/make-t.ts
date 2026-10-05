import { resolveText, type TextOverrides } from "@/domain/pagecontent/text";
import { renderTemplate } from "@/domain/templates/render";
import type { Dict, T } from "../display/text";

/**
 * Plain (no React) building blocks of the page-content helpers: the kiosk's `t` and the variables of a page.
 * Page content (D66): every wording goes through the administrator's override when there is one, else the message files.
 */

/** Variables a page offers to every text (such as the ticket number); a call may add or replace some. */
export type BaseVars = Record<string, string | number | undefined>;

export const clean = (vars: BaseVars): Record<string, string | number> =>
  Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)) as Record<string, string | number>;

/**
 * The kiosk's `t`: it reads a plain `key → text` dictionary (a kiosk shows two languages on one page, so it cannot use
 * the single-locale next-intl provider), with the overrides on top.
 */
export function makePageT(dict: Dict, lang: string, overrides: TextOverrides | undefined, base: BaseVars = {}): T {
  return (key, vars) =>
    resolveText(overrides, key, lang, { ...clean(base), ...(vars ?? {}) }, (id, v) => renderTemplate(dict[id] ?? id, v));
}

/** The same `t` with more variables filled in (for example the ticket number on the ticket screen). */
export function withVars(t: T, extra: BaseVars): T {
  const add = clean(extra);
  return (key, vars) => t(key, { ...add, ...(vars ?? {}) });
}
