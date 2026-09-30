import { normalizeArabic } from "@/domain/i18n/arabic-normalize";

/**
 * Pure matcher behind the searchable person pickers. Everything is compared after folding Arabic spelling variants
 * (alef/yaa/taa marbuta, tashkeel, tatweel), case and digit script, so "احمد" finds "أحمد" and "٠٩٤٤" finds "0944".
 */
export type Searchable = {
  /** Main display name(s): the name in the current language first, other languages after it. */
  names: string[];
  /** Identifiers people type from memory: e-mail, employee number, phone. */
  ids?: string[];
  /** Context: branch, desk, role, group. */
  context?: string[];
};

export type SearchIndex = { names: string[]; ids: string[]; context: string[]; phones: string[] };

const clean = (values: (string | null | undefined)[] | undefined) =>
  (values ?? []).filter((v): v is string => !!v && !!v.trim()).map(normalizeArabic);

export function buildIndex(s: Searchable): SearchIndex {
  const ids = clean(s.ids);
  return {
    names: clean(s.names),
    ids,
    context: clean(s.context),
    // Digits only, so "+963 944-123-456" and "0944123456" meet.
    phones: ids.map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 3),
  };
}

export function normalizeQuery(query: string): string {
  return normalizeArabic(query);
}

const wordStarts = (text: string, token: string) => text.startsWith(token) || text.includes(` ${token}`);

function tokenScore(index: SearchIndex, token: string): number {
  let best = 0;
  for (const n of index.names) {
    if (n.startsWith(token)) best = Math.max(best, 100);
    else if (wordStarts(n, token)) best = Math.max(best, 80);
    else if (n.includes(token)) best = Math.max(best, 40);
  }
  for (const i of index.ids) {
    if (i.startsWith(token)) best = Math.max(best, 70);
    else if (wordStarts(i, token)) best = Math.max(best, 60);
    else if (i.includes(token)) best = Math.max(best, 30);
  }
  for (const c of index.context) {
    if (wordStarts(c, token)) best = Math.max(best, 50);
    else if (c.includes(token)) best = Math.max(best, 20);
  }
  return best;
}

/**
 * 0 = no match. Every whitespace-separated word of the query must match somewhere; name prefixes rank first, then
 * word starts, identifiers, branch/desk. An empty query matches everything with score 1.
 */
export function scoreMatch(index: SearchIndex, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 1;
  const tokens = q.split(" ");
  let total = 0;
  let allTokens = true;
  for (const t of tokens) {
    const s = tokenScore(index, t);
    if (!s) {
      allTokens = false;
      break;
    }
    total += s;
  }
  if (allTokens) {
    if (index.names.some((n) => n.startsWith(q))) total += 50;
    return total;
  }
  // A phone typed in a local or international spelling: compare the digits alone, ignoring leading zeros.
  if (/^[\d\s+()-]+$/.test(q)) {
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 3 && index.phones.some((p) => p.includes(digits))) return 55;
  }
  return 0;
}

/** Text-vs-text convenience: true when `query` matches `text` after normalisation. */
export function matches(query: string, ...texts: string[]): boolean {
  return scoreMatch(buildIndex({ names: texts }), query) > 0;
}

/** Filters and ranks (best first, ties keep their original order). An empty query keeps the original order. */
export function filterAndRank<T>(items: T[], query: string, toSearchable: (item: T) => SearchIndex): T[] {
  if (!normalizeQuery(query)) return items;
  return items
    .map((item, i) => ({ item, i, s: scoreMatch(toSearchable(item), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
