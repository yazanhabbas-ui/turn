import ExcelJS from "exceljs";
import { normalizeSections, SECTION_SLUGS, type ExportSectionId } from "@/domain/reports/sections";
import { buildExportDoc, type Cell, type ExportDoc, type ExportLocale, type Report } from "./export-doc";
import { renderPdf } from "./export-pdf";

export type ExportFormat = "csv" | "xlsx" | "pdf";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "xlsx", "pdf"];
export const EXPORT_LOCALES: readonly ExportLocale[] = ["ar", "en"];

export type ExportFile = { filename: string; contentType: string; body: Buffer };

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * ASCII file name such as dor-report-2026-09-01_2026-09-07.xlsx; a partial export adds the section
 * (dor-report-agents-...) or "custom" for several.
 */
export function exportFilename(report: Report, format: ExportFormat, sections: readonly ExportSectionId[] | null = null): string {
  const { from, to } = report.filters;
  const chosen = normalizeSections(sections);
  const part = !chosen ? "" : chosen.length === 1 ? `-${SECTION_SLUGS[chosen[0]]}` : "-custom";
  return `dor-report${part}-${from}_${to}.${format}`;
}

/* ---------- CSV ---------- */

/**
 * Cells that start with = + - @ (or a control character) would be evaluated as formulas by Excel and friends.
 * Prefixing an apostrophe makes the spreadsheet treat them as text.
 */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(cell: Cell): string {
  if (cell === null || cell === "") return "";
  const text = typeof cell === "number" ? String(cell) : guardFormula(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = (cells: Cell[]) => cells.map(csvCell).join(",");

export function renderCsv(doc: ExportDoc): Buffer {
  const lines: string[] = [csvLine([doc.title]), ...doc.meta.map(([k, v]) => csvLine([k, v])), "", csvLine([doc.filtersTitle])];
  lines.push(...doc.filters.map(([k, v]) => csvLine([k, v])));
  for (const table of doc.tables) {
    lines.push("", csvLine([table.title]), csvLine(table.columns), ...table.rows.map(csvLine));
  }
  // UTF-8 byte order mark: without it Excel reads Arabic text as Windows-1252.
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

/* ---------- XLSX ---------- */

const sheetName = (title: string, used: Set<string>) => {
  const base =
    title
      .replace(/[\\/?*[\]:]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

export async function renderXlsx(doc: ExportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dor";
  wb.title = doc.title;
  const used = new Set<string>();
  const headFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F0" } };

  doc.tables.forEach((table, index) => {
    const ws = wb.addWorksheet(sheetName(table.title, used), {
      views: [{ rightToLeft: doc.rtl, showGridLines: false }],
    });
    let headerRow = 1;
    if (index === 0) {
      // The first sheet also carries the report heading, the period and the filters.
      ws.addRow([doc.title]).font = { bold: true, size: 16 };
      for (const [k, v] of doc.meta) ws.addRow([k, v]).getCell(1).font = { bold: true };
      ws.addRow([]);
      ws.addRow([doc.filtersTitle]).font = { bold: true, size: 12 };
      for (const [k, v] of doc.filters) ws.addRow([k, v]).getCell(1).font = { bold: true };
      ws.addRow([]);
      headerRow = ws.rowCount + 1;
    }
    const head = ws.addRow(table.columns);
    head.font = { bold: true, color: { argb: "FF0F766E" } };
    head.fill = headFill;
    head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    head.height = 30;
    for (const r of table.rows) {
      const row = ws.addRow(r.map((v) => (v === "" ? null : v)));
      row.eachCell((cell, col) => {
        if (table.kinds[col - 1] === "num") cell.alignment = { horizontal: "center" };
      });
    }
    table.columns.forEach((label, i) => {
      const longest = Math.max(
        label.length * (table.kinds[i] === "num" ? 0.75 : 1),
        ...table.rows.map((r) => String(r[i] ?? "").length),
      );
      ws.getColumn(i + 1).width = Math.min(48, Math.max(table.kinds[i] === "num" ? 9 : 14, Math.ceil(longest * 1.2) + 2));
    });
    if (index === 0) ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 0, 40);
    ws.views = [{ rightToLeft: doc.rtl, showGridLines: false, state: "frozen", ySplit: headerRow, xSplit: 0 }];
    if (table.id === "heatmap") {
      // Colour scale so busy hours stand out at a glance.
      ws.addConditionalFormatting({
        ref: `B${headerRow + 1}:Y${headerRow + table.rows.length}`,
        rules: [
          {
            type: "colorScale",
            priority: 1,
            cfvo: [{ type: "min" }, { type: "max" }],
            color: [{ argb: "FFFFFFFF" }, { argb: "FF0F766E" }],
          },
        ],
      });
    }
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/* ---------- entry point ---------- */

/** Renders a report (from `buildReport`) as CSV, Excel or PDF in Arabic or English. */
export async function buildExport(
  report: Report,
  format: ExportFormat,
  locale: ExportLocale,
  sections: readonly ExportSectionId[] | null = null,
): Promise<ExportFile> {
  const chosen = normalizeSections(sections);
  const doc = buildExportDoc(report, locale, chosen);
  const body = format === "csv" ? renderCsv(doc) : format === "xlsx" ? await renderXlsx(doc) : await renderPdf(doc);
  return { filename: exportFilename(report, format, chosen), contentType: CONTENT_TYPES[format], body };
}
