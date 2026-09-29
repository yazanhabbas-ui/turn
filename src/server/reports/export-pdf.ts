import path from "node:path";
import PDFDocument from "pdfkit";
import type { Cell, ExportDoc, ExportTable } from "./export-doc";

/*
 * PDF writer. PDFKit shapes Arabic through fontkit (contextual letter forms, right-to-left glyph order inside a
 * word) but it does not do bidirectional layout, and IBM Plex Sans Arabic ships as two subsets: Arabic letters
 * only, and Latin/digits/punctuation only. So text is split into "atoms" (a word piece in one font), the atoms are
 * ordered with a small bidi pass (Arabic letters are R, Latin and digits are L, everything else takes the
 * surrounding direction) and each atom is drawn on its own at a measured position. Spaces are gaps, not glyphs
 * (PDFKit mispositions a space that sits between two shaped Arabic words).
 */

const FONT_DIR = path.join(process.cwd(), "node_modules", "@fontsource", "ibm-plex-sans-arabic", "files");
const fontFile = (script: "arabic" | "latin", weight: 400 | 700) =>
  path.join(FONT_DIR, `ibm-plex-sans-arabic-${script}-${weight}-normal.woff`);

type Font = "ar" | "ar-b" | "lt" | "lt-b";

const ARABIC_LETTER = /[؀-ٟ٪-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<" };

type Atom = { text: string; script: "ar" | "lt"; dir: "R" | "L" | "N"; space: boolean };

/** Splits text into atoms: a space, a run of Arabic letters, or a run of everything else. */
function atomize(text: string): Atom[] {
  const atoms: Atom[] = [];
  for (const ch of text.normalize("NFC")) {
    if (/\s/.test(ch)) {
      if (!atoms.length || !atoms[atoms.length - 1].space) atoms.push({ text: " ", script: "lt", dir: "N", space: true });
      continue;
    }
    const arabic = ARABIC_LETTER.test(ch) || /[،؛؟ـ]/.test(ch);
    const digitOrLatin = /[\p{L}\p{N}%]/u.test(ch) && !arabic;
    const dir: Atom["dir"] = arabic ? "R" : digitOrLatin ? "L" : "N";
    const script: Atom["script"] = arabic ? "ar" : "lt";
    const last = atoms[atoms.length - 1];
    if (last && !last.space && last.script === script && last.dir === dir) last.text += ch;
    else atoms.push({ text: ch, script, dir, space: false });
  }
  return atoms;
}

/** Orders atoms for display (left to right) for a paragraph of the given base direction. */
function visualOrder(atoms: Atom[], base: "R" | "L"): Atom[] {
  const dirs = atoms.map((a) => a.dir);
  // Neutrals between two strong atoms of the same direction join them; otherwise they follow the paragraph.
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] !== "N") continue;
    let j = i;
    while (j < dirs.length && dirs[j] === "N") j++;
    const before = i > 0 ? dirs[i - 1] : base;
    const after = j < dirs.length ? dirs[j] : base;
    const resolved = before === after ? before : base;
    for (let k = i; k < j; k++) dirs[k] = resolved;
    i = j - 1;
  }
  const segments: { dir: "R" | "L"; atoms: Atom[] }[] = [];
  atoms.forEach((a, i) => {
    const last = segments[segments.length - 1];
    const atom = dirs[i] === "R" && MIRROR[a.text] && !a.space ? { ...a, text: MIRROR[a.text] } : a;
    if (last && last.dir === dirs[i]) last.atoms.push(atom);
    else segments.push({ dir: dirs[i] as "R" | "L", atoms: [atom] });
  });
  const ordered = base === "R" ? segments.reverse() : segments;
  return ordered.flatMap((s) => (s.dir === "R" ? [...s.atoms].reverse() : s.atoms));
}

type Ctx = {
  pdf: PDFKit.PDFDocument;
  rtl: boolean;
  left: number;
  right: number;
  bottom: number;
};

const INK = "#1f2937";
const MUTED = "#6b7280";
const BRAND = "#0f766e";
const HEAD_BG = "#e6f2f0";
const ZEBRA = "#f6f8f8";
const LINE = "#d5dcdc";

function textWidth(c: Ctx, text: string, size: number, bold: boolean): number {
  return visualOrder(atomize(text), c.rtl ? "R" : "L").reduce((sum, a) => {
    c.pdf.font(a.script === "ar" ? (bold ? "ar-b" : "ar") : bold ? "lt-b" : "lt").fontSize(size);
    return sum + c.pdf.widthOfString(a.text);
  }, 0);
}

/** One line if the heading fits, otherwise two lines split at the most balanced space. */
function headingLines(c: Ctx, label: string, width: number, size: number): string[] {
  if (textWidth(c, label, size, true) <= width) return [label];
  const words = label.split(" ");
  let best: string[] = [label];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const parts = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = Math.max(...parts.map((p) => textWidth(c, p, size, true)));
    if (w < bestW) {
      bestW = w;
      best = parts;
    }
  }
  return best;
}

/** Draws one line of mixed Arabic / Latin text. `align` is relative to the [x, x + width] box. */
function drawText(
  c: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { size: number; bold?: boolean; color?: string; align?: "start" | "end" | "center" } = { size: 9 },
) {
  const { pdf } = c;
  const bold = !!opts.bold;
  const fontFor = (a: Atom): Font => (a.script === "ar" ? (bold ? "ar-b" : "ar") : bold ? "lt-b" : "lt");
  const measure = (a: Atom) => {
    pdf.font(fontFor(a)).fontSize(opts.size);
    return pdf.widthOfString(a.text);
  };
  let atoms = visualOrder(atomize(text), c.rtl ? "R" : "L");
  let widths = atoms.map(measure);
  let total = widths.reduce((s, w) => s + w, 0);
  // Too wide: drop trailing characters of the logical text and end with an ellipsis.
  if (total > width && text.length > 1) {
    let cut = text;
    while (cut.length > 1 && total > width) {
      cut = cut.slice(0, -1);
      atoms = visualOrder(atomize(`${cut.trimEnd()}…`), c.rtl ? "R" : "L");
      widths = atoms.map(measure);
      total = widths.reduce((s, w) => s + w, 0);
    }
  }
  const align = opts.align ?? "start";
  const startLeft = align === "center" ? x + (width - total) / 2 : (align === "start") === !c.rtl ? x : x + width - total;
  pdf.fillColor(opts.color ?? INK);
  let cx = startLeft;
  atoms.forEach((a, i) => {
    if (!a.space) {
      pdf.font(fontFor(a)).fontSize(opts.size);
      pdf.text(a.text, cx, y, { lineBreak: false });
    }
    cx += widths[i];
  });
  return total;
}

function fmt(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  return cell;
}

const ROW_H = 15;

function ensureSpace(c: Ctx, y: number, need: number): number {
  if (y + need <= c.bottom) return y;
  c.pdf.addPage();
  return c.pdf.page.margins.top;
}

/** Column widths: text columns are wider than numeric ones and the whole table fills the page. */
function columnWidths(table: ExportTable, total: number): number[] {
  const weights: number[] = table.kinds.map((k, i) => (k === "text" ? (i === 0 ? 3 : 1.6) : 1));
  if (table.id === "heatmap") weights[0] = 2.4;
  const sum = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => (w / sum) * total);
}

function drawTable(c: Ctx, table: ExportTable, y: number): number {
  const widths = columnWidths(table, c.right - c.left);
  const order = table.columns.map((_, i) => i);
  if (c.rtl) order.reverse();
  // x of each column, from the left edge, in display order.
  const xs: number[] = [];
  let acc = c.left;
  for (const i of order) {
    xs[i] = acc;
    acc += widths[i];
  }
  const cellAlign = (i: number) => (table.kinds[i] === "num" ? "center" : "start") as "center" | "start";
  const headSize = table.columns.length > 12 ? 6.5 : 8;
  const headLines = table.columns.map((label, i) => headingLines(c, label, widths[i] - 6, headSize));
  const headH = headLines.some((l) => l.length > 1) ? 2 * (headSize + 3) + 8 : ROW_H + 6;
  const header = (yy: number) => {
    c.pdf.rect(c.left, yy, c.right - c.left, headH).fill(HEAD_BG);
    headLines.forEach((lines, i) => {
      const top = yy + (headH - lines.length * (headSize + 3)) / 2 + 1;
      lines.forEach((line, k) =>
        drawText(c, line, xs[i] + 3, top + k * (headSize + 3), widths[i] - 6, {
          size: headSize,
          bold: true,
          color: BRAND,
          align: cellAlign(i),
        }),
      );
    });
    return yy + headH;
  };

  y = ensureSpace(c, y, ROW_H * 3 + 6);
  y = header(y);
  const heatMax = table.id === "heatmap" ? Math.max(1, ...table.rows.flatMap((r) => r.slice(1).map((v) => Number(v) || 0))) : 0;
  table.rows.forEach((row, r) => {
    if (y + ROW_H > c.bottom) {
      c.pdf.addPage();
      y = header(c.pdf.page.margins.top);
    }
    if (table.id === "heatmap") {
      row.forEach((cell, i) => {
        if (i === 0) return;
        const v = Number(cell) || 0;
        if (v > 0)
          c.pdf
            .rect(xs[i], y, widths[i], ROW_H)
            .fillOpacity(0.15 + 0.85 * (v / heatMax))
            .fill(BRAND)
            .fillOpacity(1);
      });
    } else if (r % 2 === 1) {
      c.pdf.rect(c.left, y, c.right - c.left, ROW_H).fill(ZEBRA);
    }
    row.forEach((cell, i) => {
      const heat = table.id === "heatmap" && i > 0;
      const v = heat ? Number(cell) || 0 : 0;
      const dark = heat && v / heatMax > 0.55;
      const text = heat && v === 0 ? "" : fmt(cell);
      drawText(c, text, xs[i] + 3, y + 4, widths[i] - 6, {
        size: table.columns.length > 12 ? 7 : 8.5,
        color: dark ? "#ffffff" : INK,
        align: cellAlign(i),
      });
    });
    c.pdf
      .moveTo(c.left, y + ROW_H)
      .lineTo(c.right, y + ROW_H)
      .lineWidth(0.4)
      .strokeColor(LINE)
      .stroke();
    y += ROW_H;
  });
  return y;
}

/** Bars for visitors and served per day (drawn as vector shapes). */
function drawDayChart(c: Ctx, table: ExportTable, y: number): number {
  const days = table.rows;
  if (days.length < 2) return y;
  const h = 110;
  y = ensureSpace(c, y, h + 30);
  const width = c.right - c.left;
  const top = y;
  const base = y + h;
  const max = Math.max(1, ...days.map((r) => Number(r[1])));
  const slot = width / days.length;
  const bar = Math.min(18, slot * 0.36);
  c.pdf.moveTo(c.left, base).lineTo(c.right, base).lineWidth(0.6).strokeColor(LINE).stroke();
  days.forEach((r, i) => {
    const slotX = c.rtl ? c.right - (i + 1) * slot : c.left + i * slot;
    const cx = slotX + slot / 2;
    const vh = (Number(r[1]) / max) * (h - 14);
    const sh = (Number(r[2]) / max) * (h - 14);
    c.pdf.rect(cx - bar, base - vh, bar, vh).fill("#9fc9c3");
    c.pdf.rect(cx, base - sh, bar, sh).fill(BRAND);
  });
  const every = Math.max(1, Math.ceil(days.length / 14));
  days.forEach((r, i) => {
    if (i % every) return;
    const slotX = c.rtl ? c.right - (i + 1) * slot : c.left + i * slot;
    drawText(c, String(r[0]).slice(5), slotX, base + 4, slot * every, { size: 6.5, color: MUTED, align: "center" });
  });
  // Legend: the two column headings used by the table.
  const legendY = top - 2;
  drawText(c, table.columns[1], c.left, legendY, 120, { size: 7, color: "#5c9d95", align: "start" });
  drawText(c, table.columns[2], c.left + 130, legendY, 120, { size: 7, color: BRAND, align: "start" });
  return base + 20;
}

/** Renders the document as a landscape A4 PDF. */
export function renderPdf(doc: ExportDoc): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 36, bottom: 44, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: doc.title, Creator: "Dor" },
  });
  pdf.registerFont("ar", fontFile("arabic", 400));
  pdf.registerFont("ar-b", fontFile("arabic", 700));
  pdf.registerFont("lt", fontFile("latin", 400));
  pdf.registerFont("lt-b", fontFile("latin", 700));

  const chunks: Buffer[] = [];
  pdf.on("data", (d: Buffer) => chunks.push(d));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const m = pdf.page.margins;
  const c: Ctx = { pdf, rtl: doc.rtl, left: m.left, right: pdf.page.width - m.right, bottom: pdf.page.height - m.bottom };
  const width = c.right - c.left;

  let y = m.top;
  pdf.rect(c.left, y, width, 3).fill(BRAND);
  y += 12;
  drawText(c, doc.title, c.left, y, width, { size: 20, bold: true, color: INK });
  y += 32;
  for (const [label, value] of [...doc.meta, ...doc.filters]) {
    if (label === doc.filters[0]?.[0]) {
      y += 4;
      drawText(c, doc.filtersTitle, c.left, y, width, { size: 9, bold: true, color: BRAND });
      y += 14;
    }
    drawText(c, `${label}: ${value}`, c.left, y, width, { size: 9, color: label === doc.meta[0][0] ? INK : MUTED });
    y += 13;
  }
  y += 10;

  for (const table of doc.tables) {
    y = ensureSpace(c, y, 70);
    drawText(c, table.title, c.left, y, width, { size: 12, bold: true, color: BRAND });
    y += 20;
    if (table.id === "byDay") y = drawDayChart(c, table, y + 8);
    y = drawTable(c, table, y);
    y += 18;
  }

  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const saved = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0; // writing in the footer must not trigger a new page
    drawText(c, doc.footer(i + 1, range.count), c.left, pdf.page.height - 30, width, { size: 8, color: MUTED, align: "end" });
    pdf.page.margins.bottom = saved;
  }
  pdf.end();
  return done;
}
