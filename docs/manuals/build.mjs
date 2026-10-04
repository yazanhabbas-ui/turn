// Builds the PDF manuals from docs/manuals/src (Markdown) and docs/manuals/shots (screenshots).
//
//   node docs/manuals/build.mjs              # English and Arabic: one PDF per chapter plus the combined manual
//   node docs/manuals/build.mjs --lang=ar    # only one language
//
// Output: docs/manuals/pdf/<lang>/. Needs the Playwright Chromium that `npx playwright install chromium` provides.
// The screenshots come from `node docs/manuals/capture.mjs` (run it first when the screens changed).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { markdownToHtml } from "./lib/markdown.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(HERE, "src");
const SHOTS = path.join(HERE, "shots");
const OUT = path.join(HERE, "pdf");
const BUILD = path.join(OUT, ".build");
const PRIMARY = "#0f766e";
const ACCENT = "#b45309";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const langs = (arg("lang") ?? "en,ar").split(",");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const L = {
  en: {
    dir: "ltr",
    title: "Dor User Manual",
    product: "Dor — visitor queue system",
    toc: "Contents",
    chapter: "Chapter",
    combined: "Dor-User-Manual-EN",
    edition: (d) => `Edition ${d} · version ${version}`,
    page: "Page",
  },
  ar: {
    dir: "rtl",
    title: "دليل مستخدم دور",
    product: "دور — نظام إدارة طوابير الزوار",
    toc: "المحتويات",
    chapter: "الفصل",
    combined: "Dor-User-Manual-AR",
    edition: (d) => `إصدار ${d} · النسخة ${version}`,
    page: "صفحة",
  },
};

function fontCss() {
  const dir = path.join(ROOT, "node_modules", "@fontsource", "cairo");
  return ["400", "600", "700"]
    .map((w) =>
      fs
        .readFileSync(path.join(dir, `${w}.css`), "utf8")
        .replace(/url\(\.\/files\/([^)]+)\)/g, (_, f) => `url(${pathToFileURL(path.join(dir, "files", f)).href})`),
    )
    .join("\n");
}

const CSS = (dir) => `
${fontCss()}
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html { font-family: "Cairo", "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.75; color: #1f2937; }
body { margin: 0; direction: ${dir}; }
h1, h2, h3 { color: #0f172a; line-height: 1.35; font-weight: 700; break-after: avoid; }
h1 { font-size: 24pt; color: ${PRIMARY}; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 3px solid ${PRIMARY}; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #cbd5e1; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; color: ${PRIMARY}; }
p { margin: 0 0 3mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-inline-start: 7mm; }
li { margin: 0 0 1.5mm; }
li > ul, li > ol { margin-top: 1.5mm; }
strong { font-weight: 700; color: #0f172a; }
code { font-family: "Consolas", "Courier New", monospace; font-size: 9.5pt; background: #f1f5f9; padding: 0 1.5mm; border-radius: 1mm; direction: ltr; unicode-bidi: embed; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.6pt; break-inside: auto; }
th { background: ${PRIMARY}; color: #fff; text-align: start; padding: 2mm 3mm; font-weight: 600; }
td { border-bottom: 1px solid #e2e8f0; padding: 2mm 3mm; vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f8fafc; }
figure { margin: 4mm 0 5mm; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 105mm; border: 1px solid #cbd5e1; border-radius: 2mm; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12); }
figcaption { font-size: 9pt; color: #64748b; margin-top: 1.5mm; }
li figure { margin: 3mm 0; }
.callout { margin: 3mm 0 5mm; padding: 2.5mm 4mm; border-radius: 1.5mm; border-inline-start: 4px solid; break-inside: avoid; }
.callout.tip { background: #ecfdf5; border-color: #059669; }
.callout.note { background: #eff6ff; border-color: #2563eb; }
.callout.warning { background: #fffbeb; border-color: ${ACCENT}; }
.callout.quote { background: #f8fafc; border-color: #94a3b8; }
hr { border: 0; border-top: 1px solid #e2e8f0; margin: 5mm 0; }
.chapter { break-before: page; }
.chapter:first-of-type { break-before: auto; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; padding: 0 6mm; break-after: page; }
.cover .band { height: 6mm; width: 40mm; background: ${ACCENT}; margin-bottom: 10mm; }
.cover .kicker { font-size: 12pt; color: #64748b; letter-spacing: 0.04em; }
.cover h1 { font-size: 40pt; border: 0; margin: 4mm 0 4mm; padding: 0; }
.cover .sub { font-size: 20pt; color: #0f172a; font-weight: 600; margin-bottom: 14mm; }
.cover .meta { font-size: 10.5pt; color: #64748b; }
.toc { break-after: page; }
.toc h2 { border: 0; font-size: 20pt; color: ${PRIMARY}; margin-top: 0; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc .ch { font-weight: 700; font-size: 12pt; margin-top: 4mm; }
.toc .sec { padding-inline-start: 6mm; color: #475569; font-size: 10pt; margin: 0; }
`;

function readChapters(lang) {
  const dir = path.join(SRC, lang);
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d\d-.+\.md$/.test(f))
    .sort()
    .map((file) => {
      const slug = file.replace(/^\d\d-/, "").replace(/\.md$/, "");
      return { file, slug, no: Number(file.slice(0, 2)), md: fs.readFileSync(path.join(dir, file), "utf8") };
    });
}

function shotResolver(lang, missing) {
  return (name) => {
    const f = path.join(SHOTS, `${name}.${lang}.png`);
    if (fs.existsSync(f)) return pathToFileURL(f).href;
    missing.add(name);
    return null;
  };
}

function chapterHtml(ch, lang, missing) {
  const { html, headings } = markdownToHtml(ch.md, { resolveShot: shotResolver(lang, missing), idPrefix: `c${ch.no}-` });
  return {
    html: `<section class="chapter">${html}</section>`,
    headings,
    title: headings.find((h) => h.level === 1)?.text ?? ch.slug,
  };
}

function page(lang, body) {
  const t = L[lang];
  return `<!doctype html><html lang="${lang}" dir="${t.dir}"><head><meta charset="utf-8"><title>${t.title}</title><style>${CSS(t.dir)}</style></head><body>${body}</body></html>`;
}

function cover(lang, subtitle) {
  const t = L[lang];
  const date = new Date().toLocaleDateString(lang === "ar" ? "ar" : "en-GB", { month: "long", year: "numeric" });
  return `<div class="cover"><div class="band"></div><div class="kicker">${t.product}</div><h1>${t.title}</h1><div class="sub">${subtitle}</div><div class="meta">${t.edition(date)}</div></div>`;
}

function toc(lang, chapters) {
  const t = L[lang];
  const items = chapters
    .map(
      (c) =>
        `<li><div class="ch">${c.title}</div>${c.headings
          .filter((h) => h.level === 2)
          .map((h) => `<div class="sec">${h.text.replace(/</g, "&lt;")}</div>`)
          .join("")}</li>`,
    )
    .join("");
  return `<section class="toc"><h2>${t.toc}</h2><ol>${items}</ol></section>`;
}

async function pdf(browser, lang, name, html) {
  fs.mkdirSync(BUILD, { recursive: true });
  const file = path.join(BUILD, `${name}.html`);
  fs.writeFileSync(file, html, "utf8");
  const p = await browser.newPage();
  await p.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const t = L[lang];
  const target = path.join(OUT, lang, `${name}.pdf`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await p.pdf({
    path: target,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;direction:${t.dir}"><span>${t.title}</span><span>${t.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await p.close();
  return target;
}

const browser = await chromium.launch();
try {
  for (const lang of langs) {
    const t = L[lang];
    const missing = new Set();
    const chapters = readChapters(lang).map((ch) => ({ ...ch, ...chapterHtml(ch, lang, missing) }));
    const written = [];
    // One PDF per chapter.
    for (const c of chapters) {
      const name = `Dor-Manual-${String(c.no).padStart(2, "0")}-${c.slug}-${lang.toUpperCase()}`;
      written.push(await pdf(browser, lang, name, page(lang, cover(lang, c.title) + c.html)));
    }
    // The combined manual.
    written.push(
      await pdf(
        browser,
        lang,
        t.combined,
        page(lang, cover(lang, t.product) + toc(lang, chapters) + chapters.map((c) => c.html).join("\n")),
      ),
    );
    console.log(`[${lang}] ${written.length} PDFs written to ${path.relative(ROOT, path.join(OUT, lang))}`);
    if (missing.size) console.warn(`[${lang}] screenshots not found (skipped): ${[...missing].sort().join(", ")}`);
  }
} finally {
  await browser.close();
}
