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
- Nothing business-related is hard-coded: branding, digits, time format, Hijri, Ramadan mode, ticket numbering, password policy, lockout, invite expiry, data retention, consent text and visitor status page are all settings.

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
- **Nothing that history references is hard-deleted:** reasons, branches, desks, floors, roles, groups and schedules are archived. Pause windows and holidays are deleted outright because no history references them.

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

## Milestones

1. **Foundation** (done): repo, Docker, schema, auth + 2FA, RBAC, i18n/RTL, seed, health, CI.
2. **Admin core** (done): users, roles matrix, invites, branches/desks, reasons with agent assignment, groups, schedules and prayer pauses, priority lanes, break types, settings, audit viewer.
3. Queue engine: state machine, numbering, distribution strategies, ordering and aging, simulator.
4. Reception and agent workspaces (realtime).
5. Display and voice (TTS providers, audio pack, chime, pairing).
6. Reports, KPIs, wallboard, exports, scheduled emails.
7. Visitor status page, messaging (WhatsApp/SMS/email), CSAT.
8. Hardening: security review, retention/PDPL tooling, backups, e2e and load tests.
