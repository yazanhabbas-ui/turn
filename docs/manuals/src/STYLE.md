# Manual style guide (for authors)

The manuals are the knowledge base of "Dor (دور)", a visitor queue system. One manual per role, in English and Arabic.

## Files

- `docs/manuals/src/en/<NN>-<slug>.md` and `docs/manuals/src/ar/<NN>-<slug>.md` (same structure, same headings order).
- `docs/manuals/src/shots/<slug>.json`: the screenshots both versions use (see below).

## Audience and tone

- A new employee who is not technical. Short sentences. Say what to click and what happens next.
- Describe ONLY what the application really does. Verify every feature in the code (pages under `src/app/[locale]`, components under `src/features`, permissions in `src/domain/rbac/permissions.ts`, settings in `src/server/settings/registry.ts`). If unsure, leave it out or say what exists. Never invent buttons, menus, settings or shortcuts.
- Use the EXACT UI wording of the language you are writing: English labels from `messages/en.json`, Arabic labels from `messages/ar.json`. Put UI labels in **bold**.
- The product has NO service pauses, prayer-time breaks, holidays, working-hours, Ramadan hours or cut-off times. Never mention or invent them. (Agent _breaks_ with break types, and the service-day reset time for ticket numbers, do exist and may be described.)
- Arabic: clear Modern Standard Arabic, natural phrasing, not a literal translation. Keep product names (Dor / دور) and ticket examples such as `A-014` as in the app.
- Demo data: the manual may use the demo names (e.g. ticket A-014, desk 3) as examples, but never print the demo password.

## Structure of every manual

1. Who this guide is for (what the role does, one short paragraph) and what you can do.
2. Before you start: signing in, language, theme, password and two-step verification if relevant to the role.
3. Know your screen: a labelled tour of the main screen(s).
4. Everyday tasks: numbered step-by-step procedures, one section per task.
5. Good practice and tips.
6. Common questions and troubleshooting (a table: Problem | What to do).
7. Quick reference (a compact table of buttons/actions and what they do).
   Length: about 1,800-3,000 words in English (6-10 printed pages with screenshots). Arabic about the same.

## Markdown subset (only this is supported by the PDF builder)

- Headings `#` (title, once), `##`, `###`.
- Paragraphs, `-` bullet lists, `1.` numbered lists (nesting by two spaces), pipe tables with a header row, `**bold**`, `*italic*`, `` `code` ``.
- Tip / warning boxes: a blockquote starting with `> **Tip:**`, `> **Note:**` or `> **Warning:**` (Arabic: `> **نصيحة:**`, `> **ملاحظة:**`, `> **تنبيه:**`).
- Screenshots: `![Caption text](shot:<name>)`. The builder replaces it with the screenshot for the manual's language (`<name>.en.png` / `<name>.ar.png`). The caption is written in the manual's language. Use at most 8-10 per manual, only where a picture really helps.
- No raw HTML, no emojis, no external links.

## Screenshot spec (`docs/manuals/src/shots/<slug>.json`)

A JSON array; every `shot:<name>` used in either language must be listed once:

```json
[
  {
    "name": "agent-workspace",
    "user": "khalid@dor.local",
    "path": "/agent",
    "note": "what must be visible",
    "waitFor": "optional CSS selector",
    "fullPage": false
  }
]
```

- `user`: a demo account email (see `src/db/seed/demo.ts`; password is set by the capture script).
- `path`: the page path WITHOUT a locale prefix (the capture adds `/en` for English; Arabic is the default locale, no prefix). Display screens and kiosks need a paired device and cannot be captured: do not list them (describe them in words, or use the admin pages that configure them).
- Only list pages that show something useful in the freshly seeded demo state. Names are lower-case with hyphens and start with the manual slug.

## Quality bar

- A reader can do the task by following the steps with the screen in front of them.
- Every label, path and rule is checked against the code. When something depends on a setting or permission, say so ("if your administrator has enabled ...").
