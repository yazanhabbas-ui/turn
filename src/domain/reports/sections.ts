/**
 * The sections a report export can contain. Each maps 1:1 to a table of the export document (see `buildExportDoc`);
 * the localized label is `reportExport.sections.<id>`. Order here is the order in the file.
 */
export const EXPORT_SECTIONS = [
  "summary",
  "byDay",
  "byHour",
  "byReason",
  "byAgent",
  "byBranch",
  "bySource",
  "byShift",
  "repeatSummary",
  "repeatDistribution",
  "repeatTop",
  "csatSummary",
  "csatDistribution",
  "csatByDay",
  "csatBreakdown",
  "csatComments",
  "heatmap",
] as const;
export type ExportSectionId = (typeof EXPORT_SECTIONS)[number];

/** ASCII words used in the file name of a single-section export. */
export const SECTION_SLUGS: Record<ExportSectionId, string> = {
  summary: "summary",
  byDay: "by-day",
  byHour: "by-hour",
  byReason: "reasons",
  byAgent: "agents",
  byBranch: "branches",
  bySource: "by-source",
  byShift: "shifts",
  repeatSummary: "repeat-summary",
  repeatDistribution: "repeat-distribution",
  repeatTop: "repeat-visitors",
  heatmap: "peak-heatmap",
  csatSummary: "satisfaction",
  csatDistribution: "satisfaction-scores",
  csatByDay: "satisfaction-by-day",
  csatBreakdown: "satisfaction-breakdown",
  csatComments: "satisfaction-comments",
};

/** Quick selections in the download dialog; labels are `reportSchedules.exportMenu.presets.<id>`. */
export const EXPORT_PRESETS: { id: string; sections: readonly ExportSectionId[] }[] = [
  { id: "overview", sections: ["summary", "byDay", "byHour", "heatmap"] },
  { id: "staff", sections: ["byAgent", "byShift"] },
  { id: "repeat", sections: ["repeatSummary", "repeatDistribution", "repeatTop"] },
  { id: "feedback", sections: ["csatSummary", "csatDistribution", "csatByDay", "csatBreakdown", "csatComments"] },
];

export const isSectionId = (v: string): v is ExportSectionId => (EXPORT_SECTIONS as readonly string[]).includes(v);

/**
 * Parses a `sections=a,b` query value. Null when absent (= every section); throws on an empty list or an unknown id.
 * The result is de-duplicated and in canonical order.
 */
export function parseSections(raw: string | null | undefined): ExportSectionId[] | null {
  if (raw === null || raw === undefined) return null;
  const ids = raw.split(",").map((x) => x.trim());
  if (ids.some((x) => !isSectionId(x))) throw new Error("unknown_section");
  const set = new Set(ids);
  return EXPORT_SECTIONS.filter((id) => set.has(id));
}

/** Canonical order, no duplicates; null when the list is everything (or absent). */
export function normalizeSections(ids: readonly ExportSectionId[] | null | undefined): ExportSectionId[] | null {
  if (!ids) return null;
  const set = new Set(ids);
  const list = EXPORT_SECTIONS.filter((id) => set.has(id));
  return list.length === EXPORT_SECTIONS.length ? null : list;
}
