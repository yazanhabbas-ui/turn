# Architecture decisions and defaults

Each entry records a choice, its reasons, and how to revisit it. Newest entries are at the end.

## D1: One Node process: Next.js with a custom server (not NestJS)

- **Choice:** Next.js App Router for pages and REST route handlers. A small `server.ts` hosts Next, the Socket.IO hub and the background jobs in the same process.
- **Why:** one deployable and one language for the single on-prem box, with types shared between UI and API. Route handlers cannot hold WebSockets, hence the custom server.
- **Escape hatch:** business logic lives in `src/domain` (pure) and `src/server` (services), with no Next.js imports except request plumbing. It can move behind NestJS or a separate API process without a rewrite.

## D2: Drizzle ORM + PostgreSQL 16

- **Why:** SQL-first. Queue correctness needs `SELECT … FOR UPDATE`, advisory locks and conditional updates. Reports need `percentile_cont`, `generate_series` and window functions. Migrations are plain SQL files in `drizzle/`, reviewed and committed.
- PostgreSQL 15+ is required because `UNIQUE NULLS NOT DISTINCT` is used for scoped settings and role grants.

## D3: Own session layer on @oslojs + argon2id (not Auth.js / Lucia)

- **Why:** Lucia was deprecated (2025) and now recommends this approach. The Auth.js credentials provider does not support database sessions well.
- **How it works:**
  - The cookie holds a random 160-bit token. The database stores only its SHA-256, so a DB leak cannot hijack sessions.
  - Sessions have sliding expiry (`SESSION_TTL_HOURS`).
  - "Force logout" deletes the user's session rows.
  - Passwords use argon2id (19 MiB, t=2).
  - TOTP secrets are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`.
- **OIDC-ready:** the `oidc_accounts` table links external identities (Entra ID, Google) to users. A future OIDC callback creates the same DB session, so nothing else changes.
- **Login hardening:**
  - Accounts lock after N failures (settings: `security.maxFailedLogins`, `lockoutMinutes`).
  - Login is rate-limited per IP.
  - Unknown emails still run a password verification, so timing does not reveal whether an account exists.

## D4: CSRF and cookies

- Cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` when `APP_URL` is https (overridable by `COOKIE_SECURE`).
- Every mutating API call must carry an `Origin` (or `Referer`) matching the host or `APP_URL`, or it is rejected with `bad_origin`.
- API-key clients (integrations) will authenticate with an `Authorization` header and are exempt.

## D5: RBAC model

- Permissions are a code catalogue (`src/domain/rbac/permissions.ts`), synced to the `permissions` table by the seed.
- Roles are data. **Built-in roles are `admin`, `receptionist` and `agent`**: they are flagged `is_system`, cannot be deleted, and their permissions are re-synced from code on each seed. The display is a _device_ (token-authenticated), not a role.
- A role grant (`user_roles`) is optionally scoped to a branch (`branch_id` null means all branches).
- `can(grants, permission, branchId)` is the single check. Every data query is additionally filtered by `organization_id` and by the branches the user may access.
- **Supervisor** is seeded as an example _custom_ role (reports + reassign, no settings), showing how admins build roles from the matrix.

## D6: Internationalization

- `next-intl` with `messages/<locale>.json`. Arabic is the default locale (served at `/…`); English is at `/en/…`.
- A unit test asserts every locale has exactly the same keys and no empty strings.
- **User-entered content** (reason names, templates, branch names) is stored as JSONB `{ "ar": "…", "en": "…" }`. Adding Kurdish, Farsi, Urdu or French needs a messages file and a line in `src/i18n/locales.ts`, with no schema change.
- Message keys may not contain dots, so permission labels are nested (`permissions.tickets.issue`).
- **RTL:** `<html dir>` follows the locale. shadcn/ui components were generated with `rtl: true`, so they use logical properties (`ms-*`, `pe-*`, `start-*`). Directional icons get the `.rtl-flip` class.
- **Digits:** Western or Eastern Arabic-Indic, set separately for screens, tickets and voice (setting `regional.digits*`). Typed Eastern digits (e.g. in 2FA codes) are accepted everywhere.

## D7: Arabic name search

- `normalizeArabic` folds alef forms (أ إ آ ٱ → ا), ى → ي, ة → ه, ؤ/ئ, Persian letters, diacritics and tatweel.
- `nameSkeleton` reduces Arabic and Latin spellings to the same consonant skeleton (محمد = Mohammed = Muhammad = mhmd) for loose cross-script matching.
- Normalized values are stored in `*_search` / `*_translit` columns so they can be indexed.

## D8: Settings are typed key/value rows

- Every setting key has a Zod schema with defaults in `src/server/settings/registry.ts`.
- Stored values are merged in this order: defaults ← organization row ← branch row. Fields added in later versions fill in automatically.
- Nothing business-related is hard-coded: branding, digits, time format, Hijri, ticket numbering, password policy, lockout, invite expiry, data retention, consent text and visitor status page are all settings.

## D9: White-label

- Branding (company name, logo, colours, font, welcome text, ticket footer) is a setting and is applied as CSS variables (`--brand-primary`, `--brand-font`) on `<html>`.
- Fonts (IBM Plex Sans Arabic, Cairo, Tajawal) are bundled via `@fontsource`, so there are no Google Fonts calls at runtime.

## D10: Privacy by design (Saudi PDPL / UAE PDPL)

- Visitor fields are minimal and optional per reason (`intake_fields`).
- Phone numbers are also stored as a keyed hash (`PHONE_HASH_KEY`) for sticky routing. A retention job (hardening milestone) anonymizes visitors after `privacy.retentionDays` (default 90) and keeps the hash-free statistics.
- Logs redact phones, emails and tokens. `notifications_log` stores masked recipients only.
- There is no third-party tracking, CDN or analytics.

## D11: Realtime

- Socket.IO is attached to the same HTTP server, with connection-state recovery (2 minutes) and automatic long-polling fallback.
- Rooms per org, branch, user and display. The server is the single source of truth: clients only render events.
- With `REDIS_URL` set, the Redis adapter (realtime milestone) allows multiple app nodes. Without it, a single node runs in-memory.

## D12: Multi-tenancy

- Every table carries `organization_id`, and branch-scoped tables also carry `branch_id`. The UI assumes one organization per deployment (on-prem). Public pages (login, display) use the first organization.

## D13: Time and ticket numbers

- All timestamps are `timestamptz` in UTC. Each branch has an IANA timezone for display and business-day calculation.
- Tickets belong to a **service day**: branch-local, with a rollover at the `ticketing.dailyResetTime` setting (default 03:00, so late shifts do not reset mid-evening).
- Numbers are unique per `(branch, service_day, prefix, number)`, enforced by a unique index. They are allocated from `ticket_counters` under a row lock.

## D14: Test database safety

- Integration tests truncate tables, so `tests/setup-env.ts` forces a database whose name ends in `_test` and refuses to run otherwise.

## D15: Offline ticket issuing is deferred

- The local server keeps everything working when the _internet_ drops.
- Issuing tickets while the _local server itself_ is unreachable (the section 10 stretch goal) is deferred to the hardening milestone as optional. The planned design: pre-reserved per-device number blocks, with sync on reconnect.

## D16: UTF-8 databases are mandatory

- Postgres clusters initialised on Windows default to WIN1252, and every Arabic insert then fails. `runMigrations()` refuses to run unless the database encoding is UTF8. Test databases are created with `ENCODING 'UTF8' TEMPLATE template0`.

## D17: Admin guard rails

- **No privilege escalation:** a user cannot create a role, assign a role, or send an invite that carries a permission they do not hold themselves.
- **Branch-scoped managers:** a user whose `users.manage` is limited to certain branches only edits grants in those branches. Grants in other branches are preserved untouched.
- **Last administrator:** after any user change, at least one active user must keep an organization-wide grant with `roles.manage`. You cannot deactivate yourself.
- **Built-in roles are read-only in the UI and API.** They are re-synced from code on every seed, so edits would be lost. Clone a built-in role to customise it. A custom role can only be archived once no user holds it.
- **Nothing that history references is hard-deleted:** reasons, branches, desks, floors, roles and groups are archived. Nothing else is deleted outright because no history references them.

## D18: Invites and password resets

- Tokens are random, single-use, and stored only as SHA-256. They are claimed with an atomic `UPDATE … WHERE used_at IS NULL`.
- The invite link is always shown to the admin, so a "copy link" fallback works with no email or WhatsApp provider configured. **Resend rotates the token**, so the old link stops working.
- Accepting an invite for a role with `agent.serve` creates an agent profile in the invited branch (or the default branch).
- "Add user" without a password returns a 72-hour set-password link. An admin reset gives a 24-hour link and signs the user out everywhere.
- The invite expiry comes from the `security.inviteExpiryHours` setting.

## D19: Messaging and jobs

- **Providers:** `MessageProvider` (in `src/server/messaging`) has an SMTP email implementation and a mock (`MESSAGING_MOCK=true`, which records to an in-memory outbox). WhatsApp and SMS adapters arrive in the messaging milestone. Until then those channels report `not_configured` and the admin copies the link.
- **Templates:** messages always render from the organization's `message_templates` for (channel, event), in the recipient's language.
- **Delivery log:** every send is logged in `notifications_log` with a masked recipient.
- **Jobs:** delivery runs through pg-boss (`messages.send`, 5 retries with backoff). When the worker is not running (tests, CLI scripts), `enqueue` runs the handler inline, so behaviour is identical.

## D20: Admin UI conventions

- Forms use native `<select>` and checkboxes (styled) rather than custom popups. They work on every tablet and kiosk browser, with screen readers, and in RTL without positioning bugs.
- Bilingual fields are edited side by side (Arabic first), each with its own `dir`.
- Counts use ICU plural rules (Arabic has zero/one/two/few/many/other forms). Lists are joined with `Intl.ListFormat`, so the separator follows the locale.
- Visit-reason and priority icons come from a curated, statically bundled lucide set (`src/components/app/entity-icon.tsx`). The database stores the icon key.

## D21: Docker-free local runtime (`npm run local`)

- **Why:** the development PC has no CPU virtualization, WSL2 or admin rights, so Docker Desktop, Podman and Rancher Desktop cannot run there. Decided with the product owner on 2026-09-29.
- **What:** `scripts/local.ts` starts a bundled PostgreSQL from the `embedded-postgres` dev dependency. The cluster is UTF-8, uses locale C, stores data in `./.local/pgdata`, and listens on port 5433. The script creates the `dor` and `dor_test` databases, writes `.env` with random keys on first run, applies migrations, runs the idempotent seed, and starts the app in dev or production mode.
- **Scope:** Docker Compose remains the supported production deployment. The Definition of Done's `docker compose up` must still be verified on a machine with Docker.

## D22: Queue engine architecture

- `src/domain/distribution` is pure and I/O-free: config schema and layering, ordering and scoring, strategies, eligibility, dispatch and reservation expiry. The server builds an in-memory snapshot of the branch under its lock and asks the engine. The Simulate screen runs **the same functions** in a discrete-event simulation, so its results reflect real behaviour.
- **Rule layering:** queue → branch → global → defaults, deep-merged. Arrays (such as strategy chains and aging steps) replace rather than merge. An invalid stored layer is ignored, so a mistake cannot break the queue. Rules are read on every decision, so changes need no restart.
- **Strategy chain:** each strategy keeps only the best-ranked agents, and the next one breaks ties. Adding a strategy means adding one function to `STRATEGIES`.
- **Ordering score:** wait × waitWeight + priority × priorityWeight + aging boosts + SLA pressure + appointment boost. Tiers order the queue: max-wait-breached first (FIFO among them), then priority lanes, then the regular line. Ties are broken by queue time, then id.
- **Queue time:** `queued_at` is the ordering clock. A transfer keeps it, so the visitor keeps their place. "Send to end of queue" resets it. Waiting-time reports use `arrived_at`.
- **Agent statuses:** only AVAILABLE agents receive new work. BUSY keeps existing reservations but gets nothing new. Break, away and offline release reservations. Pressing Call next sets the agent to AVAILABLE.
- **Backups** serve a reason only during overflow (queue length or wait over the limit), or when no primary agent is free (configurable).
- **Hybrid and sticky reservations** expire after `hybrid.acceptTimeoutMinutes`. An expired hybrid reservation raises a supervisor alert. Pure push reservations do not expire while the agent is present.
- **Manual mode** never hands out unassigned tickets: reception or a supervisor assigns them.

## D23: Consistency guarantees

- Every branch mutation takes a transaction-scoped advisory lock on the branch, then updates tickets with `WHERE status = expected AND version = expected`.
- Numbers come from `ticket_counters` under the same lock and are protected by a unique index on (branch, service day, prefix, number).
- Issuing is idempotent through an `Idempotency-Key` (unique per organization).
- Integration tests fire concurrent Call next and concurrent issuing, and assert no duplicates.
- A 15-second maintenance loop evaluates automatic recalls, no-show timeouts, hybrid releases and push dispatch per branch. It is safe on several nodes, because every pass takes the branch lock.
- Time comes from `src/server/clock.ts`, which tests can move forward to exercise timeouts deterministically.

## D24: Issuing rules

- **Data minimisation:** only the reason's configured intake fields are accepted; anything else is rejected. Required fields are enforced. When personal data is provided and `privacy.requireConsent` is on, consent is required.
- Phones are normalized (Western digits, `00` becomes `+`) and hashed with `PHONE_HASH_KEY` to recognise returning visitors.

## D25: Charts

- ECharts (tree-shaken, SVG renderer) with the validated reference categorical palette: slots 1–4 pass the CVD and normal-vision checks in light and dark mode.
- Chart axes run left to right in both languages; labels are localized.
- Text is measured with the page's computed font, because Arabic glyph widths differ from the default font.
- Every chart has a table alternative on the same page.

## D26: Local performance (measured on the Windows development PC)

- **Dual-stack listening:** the server listens on `::`, which accepts IPv4 and IPv6, and falls back to IPv4 automatically. Listening on `0.0.0.0` only made every new connection to `localhost` on Windows wait ~210 ms for the IPv6 attempt to fail. `HOSTNAME` still overrides the address.
- **`npm run local` defaults to production:** it rebuilds into `.next-prod` only when sources changed, skipping lint and typecheck (`DOR_FAST_BUILD=1`) because CI runs them. Warm pages take ~50–100 ms and API calls ~10–40 ms. Before, in dev mode over `localhost`, pages took 0.5–11 s and API calls ~250 ms.
- **`--dev` uses webpack:** measured warm requests are ~45 ms with webpack versus ~450 ms with Turbopack under this custom server. `DEV_BUNDLER=turbopack` opts in. The file watcher excludes `src/` and `messages/`, because Next hot-reloads those itself; restarting the process would discard its compile cache. A warm-up pass pre-compiles the main pages after startup.
- **Background jobs:** a failure to start pg-boss (for example a transient database reset) is retried and never takes the app down. If the worker is unavailable, job handlers run inline.

## D27: Reception and agent screens

- **Realtime:** one shared Socket.IO connection per tab. It subscribes to the branch room and refetches on `queue.updated`, `ticket.called` and `agent.updated`, with bursts debounced to one refetch. While disconnected, pages poll every 5 s and show a "Reconnecting / Offline" pill; after reconnecting they refetch. Measured: reception issues a ticket and the agent's screen updates within 10–110 ms.
- **Two taps to issue:** tap a reason (featured reasons come first, and each has a keyboard shortcut), then tap **Issue**. Only the reason's configured intake fields are shown; optional ones stay collapsed. The consent checkbox appears only once personal data has been typed. Every issue attempt carries an idempotency key, which is kept on retry, so a network error never creates a second ticket.
- **Agent:** one big button changes with the state (Call next → Start service → Complete), and Enter triggers it (a USB keypad or call button works too); R recalls. No-show and complete show an 8-second Undo. Hold returns the visitor to the same agent. Transfer can go to another reason and/or a specific agent, with a note.
- **Personal data minimisation:** visitor details in the live queue are visible to people who issue, edit or reassign tickets. Agents see details only for tickets reserved for or served by them (`queueState`).
- **Printing:** the ticket prints from the editable bilingual `ticket_print` template, in the visitor's language and the configured ticket digits. An 80 mm `@page` print stylesheet works with ESC/POS thermal printers through the OS driver. The QR code (optional setting) links to `/t/<token>`, generated in the browser with no external service. Auto-print is a per-device setting kept in local storage.
- **PWA:** the web manifest takes its name and colour from the branding settings. The service worker caches only hashed static assets, fonts and icons (cache-first) and pages (network-first, falling back to the last copy). It never caches the API or realtime traffic. It registers in production only.
- **Visitor status page** `/t/<token>` (basic version; notifications arrive in Milestone 7): opens in the language chosen at reception and refreshes every 10 s until the ticket is finished.

## D28: Visit reasons are always open by default

- Decided with the product owner on 2026-09-29: no working-hours restriction by default. The demo seed no longer attaches a timetable to visit reasons, so tickets can be issued at any time.
- The working-hours feature itself is kept: timetables (with Ramadan hours) and cut-off still apply to any reason that is given a timetable in Admin → Visit reasons. The demo seed still creates an example timetable ("Office hours", Sunday–Thursday 08:00–16:00), unattached, ready to use.

## D29: No pauses, no holidays

- Decided with the product owner on 2026-09-29: service pauses (prayer and custom), holidays and closures are removed entirely. Reception controls the flow: if nobody prints a ticket, nobody is waiting, so the system never needs to block issuing or calling by time of day.
- Removed: the `pause_windows` and `holidays` tables, the branch latitude/longitude (they existed only for offline prayer times), the `adhan` dependency, the API routes, the admin UI sections, the pause banners and the `paused` reason of call-next. Migration `0001_remove_pauses_holidays`.
- Break types (including a prayer break an agent takes) are unrelated and stay.

## D30: No working hours

- Decided with the product owner on 2026-09-29, superseding D28: working hours are removed entirely. Visit reasons are always open and tickets can be issued at any time; reception decides when to issue.
- Removed: timetables and Ramadan hours (`schedules`, `schedule_rules`, the reason `schedule_id` and `cutoff_minutes` columns, the Ramadan mode setting), the Working hours admin page and API, the open/closed state on the reception screen, and the `closed` / `cutoff` ticket errors. Migration `0002_remove_working_hours`.
- The service day and ticket numbering reset time (`dailyResetTime`) stay: they are about numbering, not opening hours.

## D31: Display screens and voice

- **Pairing:** an admin creates a screen under Admin → Screens and gets a 6-character single-use code (valid 15 minutes). The TV opens `/display` and the code is typed there (or `/display?code=…`). The server returns a 160-bit device token once and stores only its SHA-256. The token lives in the TV browser storage and is sent as a Bearer header and as the Socket.IO handshake auth. Revoking, deleting or re-pairing kills the old token immediately and disconnects the socket; the TV returns to the pairing page.
- **Least data:** a screen receives ticket numbers, desk numbers, reason names and counts only. Its socket joins a separate `screens:<branch>` room that carries `queue.updated` and `ticket.called` (without the agent id), never alerts or agent status. Screens are read-only.
- **Layouts:** classic (row per desk), single (one giant number) and multi-zone (latest call, desks, slides, waiting counts), always with dark theme, ticker, clock, optional Hijri date and configured digits. Desks can be filtered by zone per screen. The language rotates between Arabic and English (or stays on one).
- **Resilience:** the last state is cached in local storage, the screen keeps showing it during a network drop, polls every 5 s while the socket is down, retries with back-off, and shows a reconnecting badge. It requests a wake lock and offers fullscreen (F, double click or the corner button).
- **Voice:** a call plays a generated chime, then each language of the sequence (or only the visitor language), repeated N times, in a queue that never overlaps. Phrases are the editable `voice/ticket_called` template (`ticket_recalled` is used for recalls when it exists). The ticket is spoken as letters plus the number without leading zeros (`A-014` → "A 14") in the voice digit system. Providers implement one interface: the browser engine (default), pre-recorded clip packs (`ar.digit.7`, `ar.letter.A`, `ar.phrase.number`…) for PCs without an Arabic voice, and cloud TTS as an extension point (it behaves like the browser provider until an adapter is added). A language with no usable voice is skipped and shown as sound trouble rather than blocking the queue.
- **Audio unlock:** browsers block sound until a gesture. If the audio context starts suspended, a full-screen "touch to enable sound" splash appears, and any tap or key press unlocks it. Kiosk Chrome started with `--autoplay-policy=no-user-gesture-required` skips the splash.
- **Defaults chosen:** voice settings are organization-wide (`voice` setting) with per-screen overrides for enabled, volume and rate. Media in ticker slides and audio packs must be local paths or inline data, never third-party URLs.

## D32: Faster ticket issuing at reception

- Requested by the product owner: fewer steps to print a ticket, with the collected data configurable, on the basis that only the receptionist types visitor data.
- **One tap:** a visit reason with no required intake fields issues its ticket on the first tap or shortcut key, and prints at once. Reasons with required fields, manual-distribution reasons and appointment check-ins still open the form, focused on the first required field, and Enter submits.
- **Priority and language moved above the reasons** (chips and a toggle) and are chosen before the tap. Priority resets to normal after each ticket; the language sticks per device. Both can be hidden.
- **No blocking dialog:** after issuing, a small banner (number, people ahead, wait, reprint) replaces the confirmation window, so the next visitor can be served immediately. The old window remains as an option.
- **Configurable:** Admin → Settings → Reception (the reception setting: one-tap, after-issue behaviour, auto-print default, priority and language choices, default language). Which data is collected, and whether it is required, stays per visit reason (Visit reasons → Visitor information to collect). The consent question is switched off with Data protection → require consent.
- **Auto-print** defaults to on; each reception PC can override it (kept in local storage). Silent printing needs Chrome started with `--kiosk-printing`.

## D33: Reports, wallboard and alerts

- **One computation path:** every KPI is computed by pure functions in `src/domain/reports/compute.ts` from flat "ticket facts" (arrival, first call, start, finish, status, recalls, transfers, returning) and the agent status log. The service only fetches and filters. This is what the unit tests pin down, and what CSV, Excel, PDF, the page and the scheduled emails all share.
- **Definitions** (so numbers are comparable): _wait_ = arrival to the FIRST call (recalls do not extend it); _service time_ = start to finish of completed tickets; _SLA compliance_ = called tickets whose wait was within their reason's target; _service level_ = called tickets within N minutes (settings, default 80% within 5); _abandonment_ = (no-show + cancelled) / visitors, and the wait before abandonment ends at the cancel or at the unanswered call; _utilisation_ = time serving / (logged-in time minus break time); _idle_ = available time minus serving time; _fairness_ = Jain's index over served counts of agents who worked (1 = perfectly even); _returning_ = the visitor had an earlier ticket (matched by the phone hash, no numbers stored).
- **Time zones:** date ranges are service days of the selected branch; hour/weekday buckets use each branch's own time zone. A range is limited to 92 days so a report stays interactive.
- **Forecast:** deliberately simple and explainable: the mean of the same weekday over the last N days (default 28), by day for the next week and by hour for tomorrow. Suggested agents = expected arrivals × average service minutes ÷ (60 × target utilisation, default 80%).
- **Anomaly alerts** (`alerts` setting, evaluated every minute per active branch): a visitor waiting too long, too many waiting, an available agent idle while people wait, and a no-show spike. Each is stored once (an hour of silence, or until acknowledged), shown live on the wallboard, pushed over Socket.IO, and optionally emailed to supervisors.
- **Wallboard** shows ticket numbers and counts only, never visitor details. Reports and the wallboard are branch-scoped by the viewer's grants.
- **Exports:** CSV with a UTF-8 BOM and formula-injection protection, Excel with right-to-left sheets for Arabic, PDF with shaped Arabic text. Scheduled reports cover the previous day or week and are emailed with the file attached.
- **CSAT** is part of Milestone 7 (visitor status page and feedback) and is not in the reports yet.
- **Demo history:** `npm run db:history` (opt-in) creates a synthetic past so reports have data; `-- --purge` removes exactly what it created.

## Milestones

1. **Foundation** (done): repo, Docker, schema, auth + 2FA, RBAC, i18n/RTL, seed, health, CI.
2. **Admin core** (done): users, roles matrix, invites, branches/desks, reasons with agent assignment, groups, priority lanes, break types, settings, audit viewer.
3. **Queue engine** (done): state machine, numbering, distribution strategies, ordering and aging, business hours, timers, distribution rules UI, simulator.
4. **Reception and agent workspaces** (done): realtime updates, two-tap issuing, thermal print with QR, appointment check-in, agent status and breaks, call/recall/start/complete/no-show/hold/transfer with undo, visitor status page, PWA.
5. **Display and voice** (done): device pairing, three layouts, live board, chime plus queued multilingual voice, TTS providers, audio unlock, wake lock, admin Screens page.
6. **Reports, KPIs, wallboard, exports, scheduled emails, forecast and anomaly alerts** (done; CSAT arrives with Milestone 7).
7. Visitor status page, messaging (WhatsApp/SMS/email), CSAT.
8. Hardening: security review, retention/PDPL tooling, backups, e2e and load tests.
