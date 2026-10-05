"use client";

import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo } from "react";
import { NAMESPACE, type PageGroup } from "@/domain/pagecontent/catalog";
import { resolveText, type TextOverrides } from "@/domain/pagecontent/text";
import type { T } from "../display/text";
import { clean, type BaseVars } from "./make-t";

export { makePageT, withVars, type BaseVars } from "./make-t";

/**
 * Page content (D66). Every wording of the kiosk and of the visitor page goes through one of the helpers here: the
 * administrator's override when there is one, else the translation from the message files.
 */

type Bag = Partial<Record<PageGroup, TextOverrides>>;
const PageTextContext = createContext<Bag>({});

/** Gives the components below the overridden texts of one group (the status page passes what the server sent). */
export function PageTextProvider({
  group,
  texts,
  children,
}: {
  group: PageGroup;
  texts: TextOverrides | undefined;
  children: React.ReactNode;
}) {
  const parent = useContext(PageTextContext);
  const value = useMemo(() => ({ ...parent, [group]: texts ?? {} }), [parent, group, texts]);
  return <PageTextContext.Provider value={value}>{children}</PageTextContext.Provider>;
}

/**
 * `t` for a group of the next-intl pages: `usePageText("visitor")("steps.waiting")`. Ids are the message paths below
 * the group's namespace, so a text that was `useTranslations("visitorStatus")("waiting")` keeps its key.
 */
export function usePageText(group: PageGroup, base: BaseVars = {}): T {
  const t = useTranslations(NAMESPACE[group]);
  const locale = useLocale();
  const overrides = useContext(PageTextContext)[group];
  const baseKey = JSON.stringify(base);
  return useCallback<T>(
    (id, vars) =>
      resolveText(overrides, id, locale, { ...clean(JSON.parse(baseKey) as BaseVars), ...(vars ?? {}) }, (i, v) =>
        t(i, v as Record<string, string | number>),
      ),
    [overrides, locale, t, baseKey],
  );
}
