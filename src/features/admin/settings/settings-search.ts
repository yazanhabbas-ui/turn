import arMessages from "../../../../messages/ar.json";
import enMessages from "../../../../messages/en.json";
import { buildIndex, scoreMatch } from "@/lib/picker-search";
import type { GroupId, SectionDef, SectionId } from "./sections/registry";

type Bag = Record<string, unknown>;
const BAGS: Record<"ar" | "en", Bag> = {
  ar: arMessages.settings as unknown as Bag,
  en: enMessages.settings as unknown as Bag,
};
const GROUP_NAMES: Record<"ar" | "en", Bag> = {
  ar: (arMessages.settings as unknown as { groups: Bag }).groups,
  en: (enMessages.settings as unknown as { groups: Bag }).groups,
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const label = (lang: "ar" | "en", key: string) => str(BAGS[lang][key]);
const title = (lang: "ar" | "en", id: SectionId) => str((BAGS[lang].tabs as Bag)[id]);

export type SearchHit = {
  section: SectionDef;
  /** Fields of the section that matched (empty when only the section itself matched). */
  fields: { key: string; anchor?: string }[];
  score: number;
};

/**
 * Searches section titles, group names, keywords and every setting label (and hint), in Arabic and English at once,
 * folding Arabic spelling variants. Best match first; an empty query returns nothing.
 */
export function searchSettings(query: string, sections: SectionDef[]): SearchHit[] {
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const section of sections) {
    const sectionScore = scoreMatch(
      buildIndex({
        names: [title("ar", section.id), title("en", section.id)],
        context: [
          ...(section.keywords ?? []),
          str(GROUP_NAMES.ar[section.group as GroupId]),
          str(GROUP_NAMES.en[section.group as GroupId]),
        ],
      }),
      query,
    );
    const fields: SearchHit["fields"] = [];
    let best = 0;
    for (const f of section.fields) {
      const s = scoreMatch(
        buildIndex({
          names: [label("ar", f.key), label("en", f.key)],
          context: [label("ar", `${f.key}Hint`), label("en", `${f.key}Hint`)],
        }),
        query,
      );
      if (s > 0) {
        fields.push(f);
        best = Math.max(best, s);
      }
    }
    if (sectionScore > 0 || fields.length) hits.push({ section, fields, score: Math.max(sectionScore * 1.2, best) });
  }
  return hits.sort((a, b) => b.score - a.score);
}
