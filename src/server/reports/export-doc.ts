import { renderTemplate } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import type { buildReport } from "./service";

export type ExportLocale = "ar" | "en";
export type Report = Awaited<ReturnType<typeof buildReport>>;

/** A table cell: text, a number (kept numeric in Excel) or empty. */
export type Cell = string | number | null;

export type ExportTable = {
  id:
    | "summary"
    | "byDay"
    | "byHour"
    | "byReason"
    | "byAgent"
    | "byBranch"
    | "byShift"
    | "repeatSummary"
    | "repeatDistribution"
    | "repeatTop"
    | "heatmap";
  title: string;
  columns: string[];
  /** Column i is text (aligned to the start side) or a number. */
  kinds: ("text" | "num")[];
  rows: Cell[][];
};

/** The language-neutral shape of a report document, rendered by the CSV, Excel and PDF writers. */
export type ExportDoc = {
  locale: ExportLocale;
  rtl: boolean;
  title: string;
  /** Period, generation time and time zone. */
  meta: [label: string, value: string][];
  filtersTitle: string;
  filters: [label: string, value: string][];
  tables: ExportTable[];
  footer: (page: number, pages: number) => string;
};

type Dict = typeof enMessages.reportExport;
const DICTS: Record<ExportLocale, Dict> = { ar: arMessages.reportExport, en: enMessages.reportExport };

/** Numbers in files: Western digits, at most one decimal. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-29 09:05" in the report's time zone. */
function stampInZone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Builds the document for a report in the requested language. Labels come from the `reportExport` messages. */
export function buildExportDoc(report: Report, locale: ExportLocale): ExportDoc {
  const t = DICTS[locale];
  const { data, filters: f } = report;
  const s = data.summary;
  const name = (n: Record<string, string>) => pickText(n, locale, "—");
  const weekday = (d: number) => t.weekdays[String(d) as keyof typeof t.weekdays];

  const meta: ExportDoc["meta"] = [
    [t.period, renderTemplate(t.periodValue, { from: f.from, to: f.to })],
    [t.generatedAt, stampInZone(report.generatedAt, report.timezone)],
    [t.timezone, report.timezone],
  ];

  const filters: ExportDoc["filters"] = [];
  const branch = f.branchId ? data.byBranch.find((b) => b.branchId === f.branchId) : undefined;
  filters.push([t.filterBranch, f.branchId ? (branch ? name(branch.name) : f.branchId.slice(0, 8)) : t.all]);
  const reason = f.reasonId ? data.byReason.find((r) => r.reasonId === f.reasonId) : undefined;
  filters.push([t.filterReason, f.reasonId ? (reason ? name(reason.name) : f.reasonId.slice(0, 8)) : t.all]);
  const agent = f.agentId ? data.agents.find((a) => a.agentId === f.agentId) : undefined;
  filters.push([t.filterAgent, f.agentId ? (agent ? name(agent.name) : f.agentId.slice(0, 8)) : t.all]);
  if (f.weekdays?.length) filters.push([t.filterWeekdays, f.weekdays.map(weekday).join(", ")]);
  if (f.hourFrom !== undefined || f.hourTo !== undefined) {
    filters.push([t.filterHours, renderTemplate(t.hoursValue, { from: pad(f.hourFrom ?? 0), to: pad(f.hourTo ?? 23) })]);
  }

  const m = t.metrics;
  const min = t.units.min;
  const pct = t.units.pct;
  const summaryRows: [string, number, string][] = [
    [m.visitors, s.visitors, ""],
    [m.served, s.served, ""],
    [m.noShow, s.noShow, ""],
    [m.cancelled, s.cancelled, ""],
    [m.transferred, s.transferred, ""],
    [m.stillOpen, s.stillOpen, ""],
    [m.waitAvg, s.wait.avg, min],
    [m.waitMedian, s.wait.median, min],
    [m.waitP90, s.wait.p90, min],
    [m.waitMax, s.wait.max, min],
    [m.serviceAvg, s.service.avg, min],
    [m.serviceMedian, s.service.median, min],
    [m.serviceP90, s.service.p90, min],
    [m.serviceMax, s.service.max, min],
    [m.sla, s.slaPct, pct],
    [
      renderTemplate(m.serviceLevel, { minutes: s.serviceLevel.minutes, target: s.serviceLevel.targetPct }),
      s.serviceLevel.pct,
      pct,
    ],
    [m.abandonment, s.abandonmentPct, pct],
    [m.avgWaitBeforeAbandon, s.avgWaitBeforeAbandonMin, min],
    [m.recallRate, s.recallRatePct, pct],
    [m.transferRate, s.transferRatePct, pct],
    [m.returning, s.returningPct, pct],
    [m.firstVisit, s.firstVisitPct, pct],
    [m.fairness, s.fairnessIndex, ""],
  ];

  const c = t.columns;
  const nums = (n: number) => Array<"num">(n).fill("num");
  const tables: ExportTable[] = [
    {
      id: "summary",
      title: t.sections.summary,
      columns: [c.metric, c.value, c.unit],
      kinds: ["text", "num", "text"],
      rows: summaryRows.map(([label, v, unit]) => [label, Math.round(v * 100) / 100, unit]),
    },
    {
      id: "byDay",
      title: t.sections.byDay,
      columns: [c.date, c.visitors, c.served, c.avgWait],
      kinds: ["text", ...nums(3)],
      rows: data.byDay.map((d) => [d.date, d.visitors, d.served, round1(d.avgWaitMin)]),
    },
    {
      id: "byHour",
      title: t.sections.byHour,
      columns: [c.hour, c.visitors, c.served, c.avgWait],
      kinds: ["text", ...nums(3)],
      rows: data.byHour.map((h) => [`${pad(h.hour)}:00`, h.visitors, h.served, round1(h.avgWaitMin)]),
    },
    {
      id: "byReason",
      title: t.sections.byReason,
      columns: [c.reason, c.visitors, c.served, c.avgWait, c.p90Wait, c.avgService, c.p90Service, c.sla],
      kinds: ["text", ...nums(7)],
      rows: data.byReason.map((r) => [
        name(r.name),
        r.visitors,
        r.served,
        round1(r.avgWaitMin),
        round1(r.p90WaitMin),
        round1(r.avgServiceMin),
        round1(r.p90ServiceMin),
        round1(r.slaPct),
      ]),
    },
    {
      id: "byAgent",
      title: t.sections.byAgent,
      columns: [
        c.agent,
        c.served,
        c.noShow,
        c.transferOut,
        c.transferIn,
        c.avgService,
        c.medianService,
        c.p90Service,
        c.loginMin,
        c.breakMin,
        c.availableMin,
        c.servingMin,
        c.idleMin,
        c.utilisation,
      ],
      kinds: ["text", ...nums(13)],
      rows: data.agents.map((a) => [
        name(a.name),
        a.served,
        a.noShow,
        a.transferOut,
        a.transferIn,
        round1(a.avgServiceMin),
        round1(a.medianServiceMin),
        round1(a.p90ServiceMin),
        round1(a.loginMin),
        round1(a.breakMin),
        round1(a.availableMin),
        round1(a.servingMin),
        round1(a.idleMin),
        round1(a.utilisationPct),
      ]),
    },
  ];
  if (data.byBranch.length > 1) {
    tables.push({
      id: "byBranch",
      title: t.sections.byBranch,
      columns: [c.branch, c.visitors, c.served, c.avgWait],
      kinds: ["text", ...nums(3)],
      rows: data.byBranch.map((b) => [name(b.name), b.visitors, b.served, round1(b.avgWaitMin)]),
    });
  }
  if (data.byShift.length) {
    tables.push({
      id: "byShift",
      title: t.sections.byShift,
      columns: [c.shift, c.visitors, c.served, c.avgWait],
      kinds: ["text", ...nums(3)],
      rows: data.byShift.map((x) => [x.shiftId ? name(x.name) : t.outsideShifts, x.visitors, x.served, round1(x.avgWaitMin)]),
    });
  }

  // Repeat visits: how often the same identified visitor came in the period.
  const rp = data.repeat;
  const stamp = (ms: number) => stampInZone(new Date(ms).toISOString(), report.timezone).slice(0, 10);
  tables.push({
    id: "repeatSummary",
    title: t.sections.repeatSummary,
    columns: [c.metric, c.value],
    kinds: ["text", "num"],
    rows: [
      [t.repeat.uniqueVisitors, rp.uniqueVisitors],
      [t.repeat.repeatVisitors, rp.repeatVisitors],
      [t.repeat.repeatRate, round1(rp.repeatRatePct)],
      [t.repeat.avgVisits, round1(rp.avgVisits)],
      [t.repeat.identifiedTickets, rp.identifiedTickets],
      [t.repeat.anonymousTickets, rp.anonymousTickets],
    ],
  });
  tables.push({
    id: "repeatDistribution",
    title: t.sections.repeatDistribution,
    columns: [c.visits, c.visitors],
    kinds: ["text", "num"],
    rows: rp.distribution.map((x) => [x.visits >= 5 ? t.fiveOrMore : String(x.visits), x.visitors]),
  });
  if (rp.top.length) {
    const reasonName = (id: string) => name(data.byReason.find((r) => r.reasonId === id)?.name ?? {});
    tables.push({
      id: "repeatTop",
      title: t.sections.repeatTop,
      columns: [c.visitor, c.phone, c.visits, c.firstVisit, c.lastVisit, c.daysBetween, c.reason],
      kinds: ["text", "text", "num", "text", "text", "num", "text"],
      rows: rp.top.map((v) => [
        v.name ?? t.anonymous,
        v.phone ?? v.phoneMasked ?? "",
        v.visits,
        stamp(v.firstAt),
        stamp(v.lastAt),
        round1(v.avgDaysBetween),
        v.reasonIds.map(reasonName).join("، "),
      ]),
    });
  }

  // Heatmap: weekday rows by hour columns.
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const [wd, hr, count] of data.heatmap.cells) grid[wd][hr] += count;
  tables.push({
    id: "heatmap",
    title: t.sections.heatmap,
    columns: [c.weekday, ...Array.from({ length: 24 }, (_, h) => pad(h))],
    kinds: ["text", ...nums(24)],
    rows: grid.map((row, wd) => [weekday(wd), ...row]),
  });

  return {
    locale,
    rtl: locale === "ar",
    title: t.title,
    meta,
    filtersTitle: t.filtersTitle,
    filters,
    tables,
    footer: (page, pages) => renderTemplate(t.footer, { page, pages }),
  };
}

/** Words used by the report emails ("All" for a schedule that covers every branch, the period wording). */
export function exportWords(locale: ExportLocale) {
  const t = DICTS[locale];
  return {
    all: t.all,
    period: (from: string, to: string) => (from === to ? from : renderTemplate(t.periodValue, { from, to })),
  };
}
