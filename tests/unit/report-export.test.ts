import fs from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ReportData } from "@/domain/reports/types";
import { EXPORT_SECTIONS, normalizeSections, parseSections } from "@/domain/reports/sections";
import { buildExport, exportFilename, guardFormula, renderCsv } from "@/server/reports/export";
import { buildExportDoc, type Report } from "@/server/reports/export-doc";

const spread = { avg: 4.2, median: 3, p90: 9, max: 14 };

function sampleReport(): Report {
  const days = Array.from({ length: 9 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  const data: ReportData = {
    range: { fromMs: 0, toMs: 1 },
    summary: {
      visitors: 120,
      served: 104,
      noShow: 9,
      cancelled: 3,
      transferred: 4,
      stillOpen: 4,
      wait: spread,
      service: { avg: 7.5, median: 6, p90: 15, max: 30 },
      slaPct: 91.3,
      serviceLevel: { minutes: 5, targetPct: 80, pct: 76.5 },
      abandonmentPct: 10,
      avgWaitBeforeAbandonMin: 6.4,
      recallRatePct: 12,
      transferRatePct: 3.3,
      returningPct: 25,
      firstVisitPct: 75,
      fairnessIndex: 0.93,
    },
    byDay: days.map((date, i) => ({ date, visitors: 10 + ((i * 7) % 9), served: 8 + ((i * 5) % 8), avgWaitMin: 3 + i / 3 })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      visitors: hour >= 8 && hour <= 15 ? 12 - Math.abs(11 - hour) : 0,
      served: hour >= 8 && hour <= 15 ? 10 - Math.abs(11 - hour) : 0,
      avgWaitMin: 4.5,
    })),
    byWeekday: [],
    byBranch: [
      { branchId: "b1", name: { ar: "الفرع الرئيسي", en: "Main branch" }, visitors: 80, served: 70, avgWaitMin: 3.9 },
      { branchId: "b2", name: { ar: "فرع الشمال", en: "North branch" }, visitors: 40, served: 34, avgWaitMin: 5.1 },
    ],
    bySource: [
      { source: "reception", visitors: 90, served: 80, avgWaitMin: 4.4 },
      { source: "kiosk", visitors: 30, served: 24, avgWaitMin: 5.2 },
    ],
    byReason: [
      {
        reasonId: "r1",
        name: { ar: "استفسار عام (خدمة سريعة)", en: "General enquiry" },
        color: "#000",
        visitors: 70,
        served: 64,
        avgWaitMin: 3.1,
        p90WaitMin: 8,
        avgServiceMin: 5.5,
        p90ServiceMin: 11,
        slaPct: 94,
      },
      {
        reasonId: "r2",
        name: { ar: "شكوى", en: "Complaint" },
        color: "#000",
        visitors: 50,
        served: 40,
        avgWaitMin: 6.2,
        p90WaitMin: 14,
        avgServiceMin: 12.4,
        p90ServiceMin: 22,
        slaPct: 82.5,
      },
    ],
    heatmap: {
      cells: [
        [0, 9, 8],
        [0, 10, 14],
        [1, 11, 20],
        [2, 12, 3],
        [3, 13, 9],
        [6, 9, 1],
      ],
      max: 20,
    },
    agents: [
      {
        agentId: "a1",
        shiftId: null,
        name: { ar: "خالد العتيبي", en: "Khalid Alotaibi" },
        served: 40,
        noShow: 3,
        transferOut: 1,
        transferIn: 2,
        avgServiceMin: 6.1,
        medianServiceMin: 5,
        p90ServiceMin: 12,
        loginMin: 480,
        breakMin: 45,
        availableMin: 130,
        servingMin: 260,
        idleMin: 45,
        utilisationPct: 72.5,
        csatAvg: 4.2,
        csatResponses: 12,
      },
      {
        agentId: "a2",
        shiftId: null,
        name: { ar: '=HYPERLINK("http://evil","x")', en: '=HYPERLINK("http://evil","x")' },
        served: 22,
        noShow: 1,
        transferOut: 0,
        transferIn: 0,
        avgServiceMin: 8,
        medianServiceMin: 7,
        p90ServiceMin: 14,
        loginMin: 300,
        breakMin: 20,
        availableMin: 100,
        servingMin: 150,
        idleMin: 30,
        utilisationPct: 60,
        csatAvg: null,
        csatResponses: 0,
      },
    ],
    byHall: [],
    byShift: [
      { shiftId: "s1", name: { ar: "صباحي", en: "Morning" }, visitors: 90, served: 80, avgWaitMin: 3.4 },
      { shiftId: "s2", name: { ar: "مسائي", en: "Evening" }, visitors: 30, served: 24, avgWaitMin: 5.8 },
    ],
    repeat: {
      uniqueVisitors: 60,
      identifiedTickets: 84,
      anonymousTickets: 36,
      repeatVisitors: 15,
      repeatRatePct: 25,
      avgVisits: 1.4,
      distribution: [
        { visits: 1, visitors: 45 },
        { visits: 2, visitors: 9 },
        { visits: 3, visitors: 4 },
        { visits: 4, visitors: 1 },
        { visits: 5, visitors: 1 },
      ],
      top: [
        {
          visitorId: "v1",
          visits: 5,
          firstAt: Date.UTC(2026, 8, 1),
          lastAt: Date.UTC(2026, 8, 20),
          avgDaysBetween: 4.8,
          reasonIds: ["r1"],
          name: '=HYPERLINK("http://x")',
          phoneMasked: "••••567",
          phone: null,
        },
      ],
    },
    csat: {
      summary: {
        responses: 0,
        avg: null,
        satisfiedPct: 0,
        responseRatePct: 0,
        eligible: 62,
        distribution: [1, 2, 3, 4, 5].map((score) => ({ score, count: 0 })),
        nps: null,
      },
      byDay: [],
      byAgent: [],
      byReason: [],
      byBranch: [],
      byShift: [],
      lowComments: [],
    },
    queueLengthByHour: [],
    backlogByDay: [],
    reasonMixWeekly: [],
  };
  return {
    filters: { from: "2026-09-01", to: "2026-09-09", reasonId: "r2", weekdays: [0, 1, 2], hourFrom: 8, hourTo: 16 },
    timezone: "Asia/Damascus",
    generatedAt: "2026-09-10T06:05:00.000Z",
    data,
  } as Report;
}

describe("report export", () => {
  const report = sampleReport();

  it("names the file with the period and an ASCII name", async () => {
    for (const format of ["csv", "xlsx", "pdf"] as const) {
      const f = await buildExport(report, format, "en");
      expect(f.filename).toBe(`dor-report-2026-09-01_2026-09-09.${format}`);
    }
  });

  describe("sections", () => {
    it("parses the section list and rejects unknown ids", () => {
      expect(parseSections(null)).toBeNull();
      expect(parseSections("byAgent,summary,byAgent")).toEqual(["summary", "byAgent"]);
      expect(() => parseSections("byAgent,nope")).toThrow();
      expect(() => parseSections("")).toThrow();
      expect(normalizeSections([...EXPORT_SECTIONS])).toBeNull();
      expect(normalizeSections(["heatmap"])).toEqual(["heatmap"]);
    });

    it("emits every section by default, one table per id", () => {
      const ids = buildExportDoc(report, "en").tables.map((t) => t.id);
      expect(ids).toEqual(EXPORT_SECTIONS.filter((id) => ids.includes(id)));
      expect(ids).toContain("byAgent");
    });

    it("keeps only the chosen tables, in canonical order, even when empty", () => {
      const doc = buildExportDoc(report, "en", ["heatmap", "byAgent"]);
      expect(doc.tables.map((t) => t.id)).toEqual(["byAgent", "heatmap"]);
      const empty = { ...report, data: { ...report.data, byShift: [] } } as Report;
      expect(buildExportDoc(empty, "en", ["byShift"]).tables.map((t) => [t.id, t.rows.length])).toEqual([["byShift", 0]]);
    });

    it("names single-section files, and renders csv, xlsx and pdf with only those tables", async () => {
      expect(exportFilename(report, "xlsx", ["byAgent"])).toBe("dor-report-agents-2026-09-01_2026-09-09.xlsx");
      expect(exportFilename(report, "csv", ["byAgent", "heatmap"])).toBe("dor-report-custom-2026-09-01_2026-09-09.csv");
      expect(exportFilename(report, "csv", [...EXPORT_SECTIONS])).toBe("dor-report-2026-09-01_2026-09-09.csv");

      const csv = await buildExport(report, "csv", "en", ["byAgent"]);
      expect(csv.filename).toMatch(/^dor-report-agents-[ -~]+.csv$/);
      const text = csv.body.toString("utf8");
      const doc = buildExportDoc(report, "en");
      expect(text).toContain(doc.tables.find((t) => t.id === "byAgent")!.title);
      expect(text).not.toContain(doc.tables.find((t) => t.id === "byDay")!.title);
      expect(text).not.toContain(doc.tables.find((t) => t.id === "heatmap")!.title);

      const xlsx = await buildExport(report, "xlsx", "en", ["byDay", "byHour"]);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.body as never);
      expect(wb.worksheets).toHaveLength(2);

      const pdf = await buildExport(report, "pdf", "ar", ["byShift", "repeatTop"]);
      expect(pdf.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.filename).toContain("custom");
    });
  });

  it("guards against spreadsheet formula injection", () => {
    expect(guardFormula("=1+1")).toBe("'=1+1");
    expect(guardFormula("+9665")).toBe("'+9665");
    expect(guardFormula("-x")).toBe("'-x");
    expect(guardFormula("@sum")).toBe("'@sum");
    expect(guardFormula("plain")).toBe("plain");
  });

  it("writes CSV with a UTF-8 byte order mark, RFC 4180 quoting and neutralised formulas", async () => {
    const f = await buildExport(report, "csv", "ar");
    expect(f.contentType).toContain("text/csv");
    expect([...f.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = f.body.toString("utf8").slice(1);
    expect(text).toContain("تقرير أداء الطابور");
    expect(text).toContain("خالد العتيبي");
    // Comma and quote in a value: quoted, quotes doubled. The formula-looking name is prefixed and quoted.
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    // Text with parentheses but no comma is not quoted; sections are separated by blank lines.
    expect(text).toContain("استفسار عام (خدمة سريعة),70,64,3.1,8,5.5,11,94");
    expect(text).toContain("\r\n\r\n");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("quotes cells containing commas and line breaks", () => {
    const doc = buildExportDoc(report, "en");
    doc.tables[1].rows = [
      ["a,b", 1, 2, 3.5],
      ['say "hi"\nnow', 1, 2, 3],
    ];
    const text = renderCsv(doc).toString("utf8");
    expect(text).toContain('"a,b",1,2,3.5');
    expect(text).toContain('"say ""hi""\nnow",1,2,3');
  });

  for (const locale of ["ar", "en"] as const) {
    it(`writes an Excel workbook with every section (${locale})`, async () => {
      const f = await buildExport(report, "xlsx", locale);
      expect(f.contentType).toContain("spreadsheetml");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(f.body as unknown as ArrayBuffer);
      const doc = buildExportDoc(report, locale);
      expect(wb.worksheets.map((w) => w.name)).toEqual(doc.tables.map((t) => t.title.slice(0, 31)));
      const ws = wb.worksheets[1];
      expect(ws.views[0].rightToLeft).toBe(locale === "ar");
      expect(ws.views[0].state).toBe("frozen");
      // Numbers stay numbers.
      expect(ws.getRow(2).getCell(2).value).toBe(10);
      expect(typeof ws.getRow(2).getCell(4).value).toBe("number");
      const summary = wb.worksheets[0];
      expect(summary.getCell("A1").value).toBe(doc.title);
      const values = summary.getSheetValues().flat();
      expect(values).toContain(120);
    });

    it(`writes a PDF (${locale})`, async () => {
      const f = await buildExport(report, "pdf", locale);
      expect(f.contentType).toBe("application/pdf");
      expect(f.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(f.body.length).toBeGreaterThan(20_000);
      if (process.env.DOR_EXPORT_SAMPLES) fs.writeFileSync(`${process.env.DOR_EXPORT_SAMPLES}/sample-${locale}.pdf`, f.body);
    });
  }
});
