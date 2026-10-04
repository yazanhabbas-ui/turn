# Dor user manuals (knowledge base)

One manual per role, in English and Arabic, as PDF files in [`pdf/en`](pdf/en) and [`pdf/ar`](pdf/ar):

| Manual                               | For                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `Dor-Manual-00-overview`             | Everyone: how a visit flows, roles, signing in, ticket statuses, glossary, FAQ    |
| `Dor-Manual-01-agent`                | Agents who serve visitors                                                         |
| `Dor-Manual-02-supervisor`           | Supervisors (floor monitoring, wallboard, reports)                                |
| `Dor-Manual-03-receptionist`         | Receptionists (issuing tickets, appointments, printing)                           |
| `Dor-Manual-04-admin`                | Administrators (Super Admin and City Admin)                                       |
| `Dor-Manual-05-screens`              | Whoever sets up display screens, kiosks, the wallboard and the announcement voice |
| `Dor-User-Manual-EN.pdf` / `-AR.pdf` | All chapters in one file, with contents                                           |

## Changing or rebuilding the manuals

The text is Markdown in [`src/en`](src/en) and [`src/ar`](src/ar) (rules in [`src/STYLE.md`](src/STYLE.md)); the screenshots each manual uses are listed in [`src/shots`](src/shots).

```bash
npm run local                  # a copy of the app with the demo data (http://localhost:3000)
npm run manuals:capture        # retake the screenshots (APP_URL and DEMO_PASSWORD can be set)
npm run manuals:build          # write the PDFs to docs/manuals/pdf
```

The build needs the Playwright Chromium (`npx playwright install chromium`). The screenshots are taken with the demo accounts, so use a freshly seeded database (`npm run db:reset`, then optionally `npm run db:history`) to get clean pictures.
