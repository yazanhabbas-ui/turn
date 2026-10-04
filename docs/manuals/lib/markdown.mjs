// A small converter for the Markdown subset the manuals use (see docs/manuals/src/STYLE.md).
// Headings, paragraphs, nested lists, pipe tables, blockquote callouts, images (shot:<name>), bold, italic, code.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline formatting: `code`, **bold**, *italic*. The text is escaped first. */
export function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

const CALLOUTS = [
  [/^\*\*(Tip|نصيحة):?\*\*:?\s*/i, "tip"],
  [/^\*\*(Note|ملاحظة):?\*\*:?\s*/i, "note"],
  [/^\*\*(Warning|تنبيه|تحذير):?\*\*:?\s*/i, "warning"],
];

function figure(alt, name, resolveShot) {
  const src = resolveShot(name);
  if (!src) return "";
  return `<figure><img src="${esc(src)}" alt="${esc(alt)}"><figcaption>${inline(alt)}</figcaption></figure>`;
}

const IMAGE = /^!\[([^\]]*)\]\(shot:([a-z0-9-]+)\)\s*$/i;

/** Splits a table row into cells. */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Converts one markdown document to HTML. `resolveShot(name)` returns the image URL or null.
 * Headings get ids from `idPrefix` so several chapters can be combined into one document.
 */
export function markdownToHtml(md, { resolveShot, idPrefix = "" }) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const headings = [];
  let i = 0;

  const isBlank = (l) => !l.trim();
  const listMatch = (l) => /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);

  function parseList(startIndent) {
    // Returns the html of a (possibly nested) list whose items start at `startIndent`.
    const first = listMatch(lines[i]);
    const ordered = /\d+\./.test(first[2]);
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}>`;
    while (i < lines.length) {
      const m = listMatch(lines[i]);
      if (!m) break;
      const indent = m[1].length;
      if (indent < startIndent) break;
      if (indent > startIndent) {
        // Nested list belongs to the previous item.
        const nested = parseList(indent);
        html = html.replace(/<\/li>$/, nested + "</li>");
        continue;
      }
      let item = inline(m[3]);
      i++;
      // Continuation lines, indented text and images under this item.
      while (i < lines.length && !isBlank(lines[i]) && !listMatch(lines[i]) && /^\s+/.test(lines[i])) {
        const t = lines[i].trim();
        const img = IMAGE.exec(t);
        item += img ? figure(img[1], img[2], resolveShot) : " " + inline(t);
        i++;
      }
      // A blank line followed by an indented image still belongs to the item.
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j > i && j < lines.length && /^\s+!\[/.test(lines[j]) && !listMatch(lines[j])) {
        const img = IMAGE.exec(lines[j].trim());
        if (img) {
          item += figure(img[1], img[2], resolveShot);
          i = j + 1;
        }
      }
      html += `<li>${item}</li>`;
    }
    return html + `</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = `${idPrefix}h${headings.length}`;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    const img = IMAGE.exec(line.trim());
    if (img) {
      out.push(figure(img[1], img[2], resolveShot));
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const parts = [];
      while (i < lines.length && lines[i].startsWith(">")) parts.push(lines[i++].replace(/^>\s?/, ""));
      let text = parts.join(" ").trim();
      let kind = "note";
      for (const [re, k] of CALLOUTS) {
        const m = re.exec(text);
        if (m) {
          kind = k;
          const label = m[1];
          text = `<strong>${esc(label)}:</strong> ` + inline(text.slice(m[0].length));
          break;
        }
        kind = "quote";
      }
      out.push(`<aside class="callout ${kind}">${kind === "quote" ? inline(text) : text}</aside>`);
      continue;
    }
    if (listMatch(line)) {
      out.push(parseList(listMatch(line)[1].length));
      continue;
    }
    // Paragraph: consecutive plain lines.
    const para = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,3}\s|>|---+\s*$|\|)/.test(lines[i]) &&
      !listMatch(lines[i]) &&
      !IMAGE.test(lines[i].trim())
    )
      para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return { html: out.join("\n"), headings };
}
