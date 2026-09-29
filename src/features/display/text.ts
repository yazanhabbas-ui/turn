import { renderTemplate } from "@/domain/templates/render";

/** The `display` message namespace of one language, flattened to `key → text`. */
export type Dict = Record<string, string>;
export type Dicts = Record<"ar" | "en", Dict>;
export type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * A waiting-room screen rotates between languages on one page, so it cannot use the single-locale next-intl
 * provider. The page passes the resource files of every language and this picks strings from the active one.
 */
export function makeT(dict: Dict): T {
  return (key, vars) => renderTemplate(dict[key] ?? key, vars ?? {});
}
