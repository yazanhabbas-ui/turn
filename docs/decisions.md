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

## D34: Bundled Arabic voice

- Most kiosk PCs (including this one) have no Arabic text-to-speech voice, and installing one needs administrator rights and the internet. The project therefore ships a pre-recorded Arabic pack: 66 clips (phrase "رقم", the desk phrase, digits 0-9, Latin A-Z and Arabic letter names) in `public/audio/ar`, generated offline with Piper and its `ar_JO-kareem-medium` voice. `npm run voice:install-arabic` registers the pack and switches the provider to pre-recorded clips; Arabic then plays from the clips while English still uses the browser voice.
- The pack speaks a ticket as "رقم" + letter + each digit + the desk phrase + the desk digits (for example A-012 at desk 1: "number, A, one, two, please go to desk, one"). Other phrase wording only applies to the browser voice.
- **Licence:** the voice model's dataset licence is listed as "see URL" (github.com/AliMokhammad/arabicttstrain). Confirm it allows commercial redistribution before shipping this pack to customers, or record your own clips into the same file names.

## D35: Choosing the Arabic voice in the admin panel

- Seven Arabic voices ship as pre-recorded packs in `public/audio/ar/<id>/` (66 clips each, listed in `catalog.json`): Microsoft neural voices Hamed (Saudi), Hamdan (Emirati), Fahed (Kuwaiti), Rami (Lebanese), Ismael (Algerian), Jamal (Moroccan), and the offline Piper voice Kareem (Jordanian). Admin → Screens → Voice → "Arabic announcement voice" lists them with a preview button (it plays a sample ticket from the pack's own clips) and a "Use this voice" button. Choosing one activates its pack (one active pack per language), switches the provider to pre-recorded clips, and reaches every paired screen at once. "Browser voice" switches back to the screen device's own voice. "Add the bundled voices" (or `npm run voice:install-arabic`) registers them for an organization.
- **Licence caveat:** the six Microsoft clips were generated with the unofficial Edge read-aloud service, which is fine for evaluation but is not a licensed production route. Before shipping to customers, regenerate them with an Azure Speech key (same voice names) or record your own clips using the same file names. The Piper voice's dataset licence is also unconfirmed (see D34).
- Custom packs can still be added by hand under "Audio packs" in the same tab.

## D36: Several visitors per agent, wallboard branding, logo and font

- **Several visitors at once** is an organization setting (Admin → Settings → Agents), off by default. When off, every agent serves one visitor at a time. When on, an agent's limit is their own number (Users → agent profile; empty = the organization default, default 2). The distribution engine already counted an agent's called and serving tickets against a limit, so the rule is applied where agents are loaded (`snapshot.ts`); nothing else changes. The agent screen shows the visitors as tabs ("2 of 3 visitors"), a new call takes focus, a "Call another visitor" button appears while there is room, and Enter/actions work on the visitor in focus. Display screens list every ticket of a desk, and the wallboard shows all of an agent's visitors on the desk card. `agent_profiles.max_concurrent` became nullable for this (migration 0004; existing 1s became "organization default").
- **Wallboard branding** (`wallboard` setting, Admin → Settings → Wallboard): theme dark, light or dark tinted with the brand colour, an optional own title, show/hide logo, company name, branch and clock, and a text size of 80-160% for far-away screens. The logo, primary/accent colours and font always come from Branding, so one change re-brands the whole product. The logo sits on a light plate on dark screens because most logos are drawn for a light background.
- **Logo:** the supplied 15499 x 5947 px PNG (700 KB, ~370 MB decoded) was resized to 1200 px (`public/branding/yallago-logo.png`, 43 KB) and 400 px; huge images can crash a TV browser. The original stays in `assets/`.
- **Font:** "FF Hekaya Light" is bundled (`public/fonts`, declared in globals.css) and selectable under Branding → Font. It covers Arabic letters and digits, Latin and punctuation, but it is a single Light weight (bold text is synthesized by the browser). Confirm your licence covers web embedding on customer sites; the readme in the font folder contains no licence text.

## D37: Round robin distribution mode

- New mode **Round robin** (Admin → Distribution): every new ticket goes to the next agent in a fixed rotation. The engine treats it as auto-assign with the `rotation` strategy (`toEngineConfig`), so reservation, capacity, hybrid timeouts and the simulator all keep working. The rotation is stateless: it continues after the agent who received the queue's previous ticket (read from `tickets.assigned_agent_id`), in agent-id order, skipping agents who are away, full or not skilled for the reason, and wraps around. `rotation` is also available as a step in the auto-assign strategy chain.
- The older strategy named "Round robin" (least recently assigned) is now labelled **Least recently assigned** to avoid confusion; its key `round_robin` in stored rules is unchanged. Note: the mode key `round_robin` and that strategy key share a name in stored data, but they are different settings (`mode` vs `push.strategies`).

## D38: Free Wi-Fi on the ticket

- Setting `wifi` (Admin → Settings → Wi-Fi): on/off, network name, password (empty = open network), an optional join-QR code, and editable heading and labels in both languages. It prints between the ticket body and the footer, in the ticket's language. Each branch can have its own values; the tab shows an "Applies to" selector, and "Use the default for this branch" removes the override.
- Branch overrides exist for settings a branch may own (`wifi`, `reception`, `alerts`, `wallboard`). Writing the organization value needs settings.manage; writing a branch value needs branches.manage on that branch, which city admins have. Everything else stays organization-wide.
- The password is printed in clear on every ticket by design (it is a public guest network); the admin page warns to use a guest network only.

## D39: Cities, super admin and city admins

- **City** groups branches (`cities`, `branches.city_id` required). Existing installations get one starter city ("Main city") holding their branches; rename it under Admin → Cities.
- **Roles.** `super_admin` has every permission organization-wide, including `cities.manage`. `admin` is now the **city admin**: everything except the organization-level permissions (cities, organization settings, role definitions, shared templates and voice packs, API keys, webhooks). On upgrade, people who held the old organization-wide `admin` role are moved to `super_admin` once so nobody loses access.
- **Scope.** A role grant is organization-wide, for one branch, or for a whole city (`user_roles.city_id`). A city grant is expanded when a session loads into one grant per branch of the city, so branches added later are covered automatically; a city with no branch yet still lets its admin create the first one.
- **Enforcement** (each covered by `tests/integration/cities.test.ts`): a city admin lists and manages only their city's branches, desks, screens, announcements, groups, distribution overrides, report schedules, alerts, audit entries and people. They cannot manage a person unless all of that person's access lies inside their scope (so never a super admin or someone who also works in another city), cannot grant more than they hold (existing escalation guard) or outside their scope, cannot create organization-wide announcements, invites or groups, cannot change the default branch, roles or organization settings. New users made by a scoped admin must be placed inside the scope.
- **Demo data:** two cities (now Damascus and Aleppo, see D40), an Aleppo branch with two desks and an agent, and accounts `admin@dor.local` (super admin), `damascus.admin@dor.local` and `aleppo.admin@dor.local` (city admins). Demo staff now hold branch-scoped instead of organization-wide roles.

## D40: Syria defaults

- Defaults now target Syria: branch time zone `Asia/Damascus`, phone country code `963` (setting `regional.phoneCountryCode`, Admin → Settings → Language & calendar), Hijri dates off by default. A local number typed at reception (`0944 123 456`) is completed to `+963944123456`, so local and international spellings of one number are the same visitor. Demo data: cities Damascus and Aleppo, Syrian names, accounts `damascus.admin@dor.local` and `aleppo.admin@dor.local`. Existing installations keep their stored values (a city named "Main city" or a branch on another time zone is changed by hand).

## D41: Agent shifts

- Shifts (`shifts`, organization-wide; defaults Morning 08:00-15:00 and Evening 15:00-22:00) say when an agent works; a shift whose end is not after its start runs past midnight. An agent has at most one (Users → agent profile). This is about staff, not about the service: the queue itself is never closed by time of day (D29, D30).
- Setting `agentWork.shiftMode`: **off** (ignored), **guide** (default: shown to the agent, used in reports, and an agent outside their shift gets no automatic assignments, but can still work and be called manually), **strict** (an agent cannot go available outside the shift and is signed out `shiftEndGraceMinutes` after it ends). Strict is opt-in and was the compromise between the request for shifts and the rule of no time restrictions.
- Reports gain a "by shift" table (visitors, served, average wait; tickets outside every shift are grouped separately) and a shift per agent.

## D42: Limit on simultaneous breaks

- Setting `breaks` (Admin → Settings → Breaks; on by default with 2 agents at a time and a 3-minute hold): the most agents of a branch that may be on a break at once, as a fixed number or a percentage of signed-in agents (at least one), and how long an offered place is held (`holdMinutes`).
- When the limit is reached an agent's status does not change; they join a first-in-first-out line (`break_requests`), are told how many colleagues are on a break and their place, and receive a `break.update` event (only to that agent) when a place is free. The place is held for them for `holdMinutes`; if unused it passes to the next agent and the first goes to the back if they ask again. The line is served by every status change and by the periodic maintenance.

## D43: Repeat visitors and what agents see

- Reception's data is already stored on the ticket and visitor; the agent screen shows all of it (name, phone, company, every configured field) plus the visit number, the last visit and the previous visits of that visitor (date, reason, outcome, agent).
- A visitor is recognised by the mobile number (hash of the normalised phone). Tickets without a phone or name are "anonymous" and cannot be linked.
- The report "Repeat visits" counts, for the selected period, unique identified visitors, those who came more than once, the repeat rate, the average visits and a 1..5+ distribution, plus a list of returning visitors (first/last visit, average days between visits, reasons). Names and phone numbers are masked unless the viewer holds the personal-data permission (`visitors.privacy`); exports follow the same rule.

## D45: Searchable pickers

- Wherever a person is chosen from a list (transfer, assign at reception, group supervisor and members, reason assignments, simulator agents, report agent filter) the plain select or checkbox list is replaced by `AgentPicker` / `AgentMultiPicker` (`src/components/admin/agent-picker.tsx`), so large teams can find someone by typing. Short lists (roles, statuses, branches) stay native selects.
- Filtering is client-side on the loaded list by the pure matcher `src/lib/picker-search.ts`: Arabic spelling variants, tashkeel, case and digit script are folded; name, every language of the name, e-mail, phone, code, branch and desk are searched; name prefixes rank first.
- At most 50 rows are drawn ("N more, keep typing"), grouped by branch when there are several and nothing is typed. Values and API bodies are unchanged. Keyboard: arrows, Enter, Esc (closes the list, not the dialog).

## D46: Export by section

- A report file can contain any subset of its tables. The section ids are one fixed list in `src/domain/reports/sections.ts` and map 1:1 to the export tables: summary, byDay, byHour, byReason, byAgent, byBranch, byShift, repeatSummary, repeatDistribution, repeatTop, heatmap. Labels are `reportExport.sections.<id>`. Wait-time and queue-length charts and the forecast are not export tables, so they are not sections.
- `GET /reports/export` takes an optional `sections=id1,id2`. Absent means the full report, exactly as before; an unknown id or an empty list is a 400. Tables keep the canonical order. A chosen section is always written, even with no rows (the default report still omits branch, shift and top-visitor tables when there is nothing to show). Permission, branch scope and PII masking are unchanged.
- File name: `dor-report-<from>_<to>.<ext>` for everything, `dor-report-agents-...` for one section, `dor-report-custom-...` for several.
- Reports page: the Download button opens a dialog (file type, language of the interface, section checkboxes, select all / clear, quick picks) and every report card has a small download icon for its own sections using the current filters and the last file type used (kept in localStorage, optional). Empty sections are marked but downloadable. All of it is hidden when printing.
- Scheduled emails store `report_schedules.sections` (jsonb, null = all; migration 0009) and the scheduler passes it to the same builder. Selecting every section is stored as null.

## D44: User profiles

- **Profile page** `/profile` (linked from the avatar in the header; `/account` keeps password, two-step verification and language, linked from the profile). It shows the picture, name, email, roles with their scope (organization, city, branch), the branch an agent works at, member since and last sign-in. Name and phone are not editable by the user: the account API has no such endpoint, only admins change them.
- **Picture.** Every user sets their own; nobody sets another person's. The upload (multipart, 2 MB, png/jpeg/webp checked by sharp on the real content, not by name or declared type) is rotated by its EXIF orientation, cropped to a square, resized to 256x256 webp and stripped of metadata before it is stored in `user_avatars` (bytea; kept out of `users` so user queries never load it). `users.avatar_version` is the cache key: `/api/v1/users/:id/avatar?v=<version>` is served with an ETag and a year of private caching. Someone with `users.manage` (within their scope) may remove another person's picture. Missing pictures show coloured initials (`<UserAvatar>` in `src/components/app/user-avatar.tsx`, also used in the users list). The picture is not a URL a user can supply, so nothing external is ever loaded. Migration 0010.
- **My activity** (`/api/v1/me/activity`) lists the user's own audit entries and, for agents, the tickets they served (number, reason, outcome, service and wait time); receptionists also see tickets they issued. Own rows only, no permission beyond being signed in; the audit page stays under `audit.view`. Cursor pagination ("load more"), last 30 days by default.
- **My progress** (`/api/v1/me/progress`, computed by the pure `src/domain/profile/progress.ts`): for agents today / this week / this month tiles (served, average service time, average wait of their visitors, share completed, no-shows, available and break time), a per-day trend of 14 or 30 days, the change against their own previous period, and the branch average as an aggregate (never a list or a ranking of colleagues). The comparison is like for like: this week so far against the same elapsed time of last week. Milestones: total served, best day, and a streak of working days in a row with at least one visitor served (a working day is a day the branch served anybody, so weekends and days off neither count nor break it). Receptionists see tickets issued; everybody sees how many audited actions they made. Days are counted in the agent's branch time zone. Nothing here depends on the time of day the service is open (D29, D30).

## D47: Waiting-time estimate

The waiting time on the ticket, the issue confirmation, the visitor page, the wallboard and the queue views is one figure from one place: `BranchContext.wait` (`src/server/queue/wait-analytics.ts`), driven by the setting group `waitEstimate` (organization default, overridable per branch like Wi-Fi). It is only an estimate and never blocks issuing or calling (D29, D30).

- **How long one visitor takes (`mode`):** `reason` (default, the previous behaviour: each reason's expected minutes), `fixed` (`fixedMinutesPerVisitor`, 0.5-120) or `analytics` (learned from completed tickets, `finishedAt - startedAt`). `divideByAgents` decides whether the queue is divided by the agents serving it.
- **Analytics:** looks back `lookbackDays` (default 14); below `minSamples` (default 20) valid services of a reason its expected time is used and the admin sees "Learning: 8 of 20". `statistic` is median (default, robust), average or p75 (cautious). `trimOutliers` drops services under 20 seconds or over 4 hours and the fastest and slowest 5%. `weightByHour` uses only services within one hour of now (the same weekday first) when there are enough of them, otherwise all. Weekends are not hard-coded, so there is no weekday-type rule beyond the same weekday.
- **Cost:** one light query per branch, cached for 5 minutes, and only in analytics mode; it runs in a savepoint and any failure falls back to the reason's own time, so issuing is never slowed or failed by it.
- **Shape:** `rounding` (up to 1, 5 or 10 minutes), `bufferPercent` safety margin, `showAsRange` ("10-15 min" from the p25-p75 of real services, or +/-25% in the other modes), `minShown` (below it the visitor sees the "next" text instead of a number).
- **Wording** (all bilingual and editable): `label` (default "Estimated wait"), `unitLabel`, `nextText`, `disclaimer` (optional small note). `showOnTicket` off hides the figure on the printed ticket, the confirmation and the status page. The printed ticket uses the ticket's language. Template lines containing `{wait}` are no longer printed: the wait line comes from these settings so an old template cannot show a second, different number (the seed template no longer carries `{wait}`).
- **Admin:** Settings, "Waiting time" tab: mode cards, only the fields of the chosen mode, a live preview (1, 3, 6 and 10 ahead) and, in analytics mode, a table of real samples, median, average and p75 against the expected time and the value in use. The table is `GET /api/v1/admin/wait-analytics?branchId=` (reports.view on that branch, organization-wide without `branchId`).

## D48: Uploaded logo

- The logo is uploaded in Settings, Branding, instead of pasting a link. `POST /api/v1/admin/branding/logo` (multipart `file`, png/jpeg/webp/still gif, 5 MB, permission `settings.manage` organization-wide, rate-limited, audited) checks the real type with sharp (no svg, since it can carry scripts; animated pictures are refused), guards the decoded size at 100 megapixels (a 15499x5947 original is fine), keeps transparency, fits the picture inside 1200x480 without ever enlarging it, drops metadata and stores a png in `brand_assets` (bytea, one row per organization and kind `logo`, `version` bumped on each upload). Migration 0011.
- The upload then sets `branding.logoUrl` to `/api/v1/public/branding/logo?v=<version>` through the normal settings service, so the app shell, screens, wallboard, tickets and the sign-in page keep reading the same setting. The public GET is cacheable (ETag; a year with `?v=`) and serves the first organization's logo, like the other public pages. `DELETE` removes the row and sets `logoUrl` to null.
- `logoUrl` stays a plain string: an existing link or path keeps working, and the uploader keeps an "Advanced: use a link instead" field. `<LogoUploader>` (`src/features/admin/settings/logo-uploader.tsx`) shows the logo on a transparency checkerboard and on light and dark strips.

## D49: Settings page layout

- **Two columns.** Admin, Settings is a grouped vertical navigation on the start side (logical CSS, so it flips in Arabic) and the active section on the other. Groups: General (Branding, Language & calendar), Visitors & tickets (Tickets, Reception, Wi-Fi, Waiting time, Visitor page, Priority lanes), Agents & service (Agents & shifts, Break limit, Break types), Screens & reports (Wallboard, Reports, Alerts), Security & privacy (Security, Data protection). On a phone the navigation is a grouped select under the search box.
- **One list drives everything** (`src/features/admin/settings/sections/registry.ts`): id, group, icon, scope ("Applies to" badge), whether a city or branch admin may open it (only Wi-Fi and Waiting time, as before) and the search entries (`{ key, anchor }` per field label plus free `keywords`). Adding a setting means one line there.
- **Deep link.** The active section is `?section=<id>` (written with `history.replaceState`); the default is the first section available to the user.
- **Search.** A box above the navigation (focus with `/` or Ctrl/Cmd+K) matches section titles, group names, keywords and field labels and hints in both languages at once, using the Arabic-folding matcher of `picker-search.ts`. Choosing a field result opens its section, scrolls to the input and flashes it.
- **Saving.** Each section keeps its own draft (`SettingForm`, same PUT bodies as before). A sticky bar appears only while the draft differs from the saved value: Save (Ctrl/Cmd+S) and Discard; API errors are shown in the bar, and a "saved" confirmation follows. Leaving a section, changing the Wi-Fi branch or closing the tab with unsaved edits asks first (warn, not auto-keep: the simplest rule that cannot lose or silently apply edits). When the saved value changes underneath (e.g. the logo uploader saving `logoUrl`), only the changed keys are taken over, so other unsaved edits survive. The waiting-time section keeps its own Save button.
- **Files.** One file per section in `sections/`, plus `settings-shell.tsx` (layout, search, header, guard dialog), `setting-form.tsx`, `setting-card.tsx`, `setting-field.tsx`; `settings-page.tsx` is only the entry. Branding has a live preview (logo, name, colours, font on a mini header and ticket) and mounts `LogoUploader`.

## D50: Display themes and dark logo

- **Theme per screen.** A waiting-room screen has `config.theme`: `default` (follow the `displayTheme` setting), `dark`, `light` or `brand` (dark tinted with the primary brand colour, the same idea as the wallboard). Missing = `default`, and the default setting is `dark`, so existing screens look exactly as before (no data migration). `displayTheme.theme` is a new setting, branch-overridable like `wallboard`; edited in Settings, Wallboard section, in its own card "Waiting-room screens". The server resolves the effective look into `state.display.theme`.
- **One token set.** The display root carries `data-theme` and the brand colours as CSS variables; every colour comes from `--dsp-*` tokens defined in `globals.css` (Tailwind utilities `bg-dsp-surface`, `text-dsp-muted` and so on), so the layouts have no theme conditionals. Text pairs meet WCAG AA on their surface in all three themes; the call flash uses the same tokens (`--dsp-hot*`, `--dsp-ring`). The accent colour is lightened on dark surfaces and darkened on the light one so an arbitrary brand accent stays readable. The pairing screen (no theme known yet) stays dark. The palette helpers shared with the wallboard are in `src/domain/branding/surface-theme.ts` (theme list, brand background mix, logo choice).
- **Edit UI.** The screen dialog shows four cards: "Use the default" and small previews of dark, light and brand (the brand preview uses the primary colour).
- **Dark logo.** `branding.logoDarkUrl` (null by default) is a second uploaded asset: `brand_assets` kind `logo_dark`, same processing as the logo (transparency kept, fitted inside 1200x480), no migration. `POST /admin/branding/logo` takes a `variant` field (`light` default, `dark`), `DELETE ?variant=dark` and the public `GET ?variant=dark` follow. Settings, Branding shows a second card "Logo for dark backgrounds (optional)" with its preview on a dark checkerboard.
- **Which logo where.** Dark or brand theme: `logoDarkUrl ?? logoUrl`; light theme: `logoUrl` (`logoForTheme`). Used by the display header and the wallboard. The app shell, sign-in card and printed ticket stay on `logoUrl`. `logoDarkUrl` is exposed beside `logoUrl` in the display state, `/reports/live` and the reception payload.

## Milestones

1. **Foundation** (done): repo, Docker, schema, auth + 2FA, RBAC, i18n/RTL, seed, health, CI.
2. **Admin core** (done): users, roles matrix, invites, branches/desks, reasons with agent assignment, groups, priority lanes, break types, settings, audit viewer.
3. **Queue engine** (done): state machine, numbering, distribution strategies, ordering and aging, business hours, timers, distribution rules UI, simulator.
4. **Reception and agent workspaces** (done): realtime updates, two-tap issuing, thermal print with QR, appointment check-in, agent status and breaks, call/recall/start/complete/no-show/hold/transfer with undo, visitor status page, PWA.
5. **Display and voice** (done): device pairing, three layouts, live board, chime plus queued multilingual voice, TTS providers, audio unlock, wake lock, admin Screens page.
6. **Reports, KPIs, wallboard, exports, scheduled emails, forecast and anomaly alerts** (done; CSAT arrives with Milestone 7).
7. Visitor status page, messaging (WhatsApp/SMS/email), CSAT.
8. Hardening: security review, retention/PDPL tooling, backups, e2e and load tests.
