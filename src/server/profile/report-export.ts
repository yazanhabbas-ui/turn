import { renderTemplate } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { zonedParts } from "@/domain/schedule/time";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import { now as clockNow } from "../clock";
import type { Actor } from "../admin/actor";
import { renderCsv, renderXlsx, type ExportFile, type ExportFormat } from "../reports/export";
import { renderPdf } from "../reports/export-pdf";
import { round1, type ExportDoc, type ExportLocale, type ExportTable } from "../reports/export-doc";
import { myReport, myReportAllDetails, type ReportQuery } from "./report";

type Dict = typeof enMessages.profile.reports.export;
const DICTS: Record<ExportLocale, Dict> = { ar: arMessages.profile.reports.export, en: enMessages.profile.reports.export };

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (iso: string | number, tz: string) => {
  const p = zonedParts(new Date(iso), tz);
  return `${p.date} ${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`;
};

/**
 * The signed-in agent's own report as CSV, Excel or PDF: tables summary, daily, byReason and details. Built from the
 * same computation and the same masking as the screen (the phone number is masked unless the viewer holds `visitors.privacy`).
 */
export async function buildMyReportExport(
  actor: Actor,
  q: ReportQuery,
  format: ExportFormat,
  locale: ExportLocale,
  displayName: Record<string, string>,
): Promise<ExportFile> {
  const [report, details] = await Promise.all([myReport(actor, q), myReportAllDetails(actor, q)]);
  const t = DICTS[locale];
  const { range } = report;
  const tz = range.timezone;
  const feedback = report.csat !== null;
  const c = t.columns;
  const n = (v: number | null) => (v === null ? null : round1(v));

  const s = report.totals;
  const p = report.comparison.previous;
  const b = report.comparison.branch;
  const metric = (label: string, pick: (x: typeof s) => number | null, unit = ""): (string | number | null)[] => [
    unit ? `${label} (${unit})` : label,
    n(pick(s)),
    n(pick(p)),
    b ? n(pick(b)) : null,
  ];
  const summaryRows = [
    metric(t.metrics.served, (x) => x.served),
    metric(t.metrics.noShows, (x) => x.noShows),
    metric(t.metrics.avgService, (x) => x.avgServiceMin, t.units.min),
    metric(t.metrics.avgWait, (x) => x.avgWaitMin, t.units.min),
    metric(t.metrics.resolved, (x) => x.resolvedPct, t.units.pct),
    ...(feedback ? [metric(t.metrics.avgScore, (x) => x.avgScore), metric(t.metrics.responses, (x) => x.responses)] : []),
  ];

  const dailyCols = [c.date, c.served, c.noShows, c.avgService, c.avgWait, c.resolved, ...(feedback ? [c.avgScore] : [])];
  const tables: ExportTable[] = [
    {
      id: "summary",
      title: t.sections.summary,
      columns: [c.metric, t.thisPeriod, t.previousPeriod, t.branchAverage],
      kinds: ["text", "num", "num", "num"],
      rows: summaryRows,
    },
    {
      id: "daily",
      title: t.sections.daily,
      columns: dailyCols,
      kinds: dailyCols.map((_, i) => (i === 0 ? "text" : "num")),
      rows: [
        ...report.daily.map((d) => [
          d.date,
          d.served,
          d.noShows,
          n(d.avgServiceMin),
          n(d.avgWaitMin),
          n(d.resolvedPct),
          ...(feedback ? [n(d.avgScore)] : []),
        ]),
        [
          t.total,
          s.served,
          s.noShows,
          n(s.avgServiceMin),
          n(s.avgWaitMin),
          n(s.resolvedPct),
          ...(feedback ? [n(s.avgScore)] : []),
        ],
      ],
    },
    {
      id: "byReason",
      title: t.sections.byReason,
      columns: [c.reason, c.count, c.avgService],
      kinds: ["text", "num", "num"],
      rows: report.byReason.map((r) => [pickText(r.name, locale, "—"), r.count, n(r.avgServiceMin)]),
    },
    {
      id: "details",
      title: t.sections.details,
      columns: [
        c.number,
        c.reason,
        c.visitor,
        c.phone,
        c.arrived,
        c.called,
        c.started,
        c.finished,
        c.wait,
        c.service,
        c.outcome,
        ...(details.feedbackOn ? [c.score] : []),
      ],
      kinds: [
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "num",
        "num",
        "text",
        ...(details.feedbackOn ? (["num"] as const) : []),
      ],
      rows: details.rows.map((r) => [
        r.displayNumber,
        pickText(r.reason, locale, "—"),
        r.visitorName ?? "",
        r.visitorPhone ?? "",
        stamp(r.arrivedAt, tz),
        r.calledAt ? stamp(r.calledAt, tz) : "",
        r.startedAt ? stamp(r.startedAt, tz) : "",
        stamp(r.finishedAt, tz),
        r.waitMin,
        r.serviceMin,
        [r.status === "COMPLETED" ? t.outcomes.COMPLETED : t.outcomes.NO_SHOW, r.outcome].filter(Boolean).join(" · "),
        ...(details.feedbackOn ? [r.score] : []),
      ]),
    },
  ];

  const doc: ExportDoc = {
    locale,
    rtl: locale === "ar",
    title: t.title,
    meta: [
      [t.period, renderTemplate(t.periodValue, { from: range.from, to: range.to })],
      [t.generatedAt, stamp(clockNow(), tz)],
      [t.timezone, tz],
    ],
    filtersTitle: t.preparedFor,
    filters: [[t.agent, pickText(displayName, locale, "—")]],
    tables,
    footer: (page, pages) => renderTemplate(t.footer, { page, pages }),
  };
  const body = format === "csv" ? renderCsv(doc) : format === "xlsx" ? await renderXlsx(doc) : await renderPdf(doc);
  return { filename: `dor-my-report-${range.from}_${range.to}.${format}`, contentType: CONTENT_TYPES[format], body };
}
