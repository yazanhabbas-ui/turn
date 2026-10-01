# Dor (دور): visitor queue and turn distribution

An Arabic-first, fully bilingual (AR/EN) system for in-office visitor queues. Reception issues tickets by visit reason, the system routes them to agents according to admin-configured rules, a waiting-room screen calls numbers with voice announcements, and admins get KPIs.

It runs entirely on your own server (on-premises or a regional cloud), keeps working on the office LAN without internet, and sends no data to third parties.

> **Status:** Milestones 1–7 are complete (foundation, admin core, queue engine, reception and agent workspaces, display and voice, reports, notifications and feedback). Milestone 8 (hardening) is in progress: deployment files, backups, CI and operations are written (D58) but `docker compose up` has not been run on the development machine, which has no Docker; the CI `docker` job is the check. See [docs/decisions.md](docs/decisions.md) for the milestone plan.

## Quick start (Docker, recommended)

Requirements: Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).

```bash
cp .env.example .env        # optional for a trial; set the keys below for anything real
docker compose up -d        # builds the app, starts Postgres, migrates, seeds demo data (trial mode)
```

Open <http://localhost:3000> and sign in:

| Account                    | Role                     | Password (demo) |
| -------------------------- | ------------------------ | --------------- |
| `admin@dor.local`          | Super admin (all cities) | `Dor@Demo2026`  |
| `damascus.admin@dor.local` | City admin (Damascus)    | `Dor@Demo2026`  |
| `aleppo.admin@dor.local`   | City admin (Aleppo)      | `Dor@Demo2026`  |
| `supervisor@dor.local`     | Supervisor (custom)      | `Dor@Demo2026`  |
| `reception@dor.local`      | Receptionist             | `Dor@Demo2026`  |
| `khalid@dor.local` …       | Agent (5 demo agents)    | `Dor@Demo2026`  |

**Trial only.** For a real installation use the production file, no demo data and your own administrator: see [docs/deployment.md](docs/deployment.md) (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`).

Generate the two secrets:

```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 24      # PHONE_HASH_KEY
```

Without a `.env`, the base compose file uses built-in development keys so a clean machine still starts (the application logs a warning). The production file has no such defaults and refuses to start without real secrets. The image and the compose files have not been run on the development machine (no Docker there); the CI `docker` job builds and smoke-tests them, see D58.

## Quick start without Docker (any Windows/macOS/Linux PC, no admin rights)

Use this when Docker isn't available, for example on a Windows PC without virtualization, WSL2 or admin rights. It needs Node.js 22+ only.

```bash
npm install
npm run local            # bundled PostgreSQL + migrations + demo seed + app → http://localhost:3000
```

- **First run:** creates `.env` with fresh random keys and initialises a UTF-8 PostgreSQL in `./.local/pgdata` (git-ignored). The data is kept between runs.
- **Default mode is production** (fast: pages in ~50–100 ms). The app is rebuilt automatically, into `./.next-prod`, only when the code has changed since the last build. A rebuild takes one to two minutes.
- **Working on the code:** `npm run local -- --dev` runs with hot reload. After startup it pre-compiles the main pages in the background; wait for "pages pre-compiled" in the console before clicking around.
- **Database only** (for `npm test` or other tools): `npm run local -- --db`. The database listens on `localhost:5433`, user `dor`, password `dor`. Change the port with `LOCAL_PG_PORT`.
- **Stopping:** press Ctrl+C. This stops the app and PostgreSQL cleanly.

The PostgreSQL binaries come from the `embedded-postgres` npm package, so nothing is installed system-wide. For a real office server, prefer Docker Compose on Linux (below), or a native PostgreSQL installation.

## Local development

Requirements: Node.js 22+ and PostgreSQL 15+. The easiest options are `npm run local -- --db` or `docker compose up -d db`.

```bash
npm install
cp .env.example .env         # set the two keys; DATABASE_URL points at localhost:5432
npm run db:migrate
npm run db:seed              # idempotent; `npm run db:reset` wipes and re-seeds (dev only)
npm run dev                  # http://localhost:3000 with hot reload (Next.js + Socket.IO in one process)
```

| Script                                  | Purpose                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                           | Dev server (`server.ts` via tsx watch)                         |
| `npm run build` / `npm start`           | Production build / start                                       |
| `npm test`                              | Unit + integration tests (integration uses `<db>_test`)        |
| `npm run test:unit`                     | Unit tests only (no database needed)                           |
| `npm run test:e2e`                      | Browser tests (Playwright) on a private app and database       |
| `npm run load:smoke` / `load:full`      | Load tests: 30 s smoke, 5 min busy morning (see docs)          |
| `npm run lint` / `typecheck` / `format` | Quality gates (also run in CI)                                 |
| `npm run db:generate`                   | Create a SQL migration after editing `src/db/schema`           |
| `npm run db:migrate` / `db:seed`        | Apply migrations / seed                                        |
| `npm run admin:create`                  | Create the first super admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| `npm run verify:deploy`                 | Static checks of Dockerfile, compose, env docs, CI             |
| `npm run backup` / `restore`            | Node backup tool (see docs/backup-restore.md)                  |

Integration tests **truncate tables**. They always run against a separate database (`TEST_DATABASE_URL`, or the dev database name + `_test`), and they create it automatically.

### Testing

Four layers: unit, integration, end-to-end and load (decision D59, [docs/testing.md](docs/testing.md), [docs/load-testing.md](docs/load-testing.md)). The browser and load tests are hermetic: each starts its **own** app (ports 3200 and 3201) on its **own** database (`dor_e2e`, `dor_load`, re-created every run), so they can run next to your development app on port 3000 and never touch its data.

```bash
npm run local -- --db       # PostgreSQL on localhost:5433, if it is not running yet
npx playwright install chromium   # first time only
npm run test:e2e            # 8 scenario files; E2E_DATABASE_URL, E2E_PORT, E2E_DIST_DIR (use a finished build) are optional
npm run load:smoke          # 30 s of load, exits 1 when a threshold or a queue invariant fails
LOAD_DURATION=60 npm run load:full
```

## Environment variables

[.env.example](.env.example) is the complete commented list. [docs/operations.md](docs/operations.md#environment-variables) has the single reference table (required or optional, defaults, how to generate secrets). The essentials:

| Variable                                          | Required    | Description                                                         |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `APP_URL`                                         | production  | The address people type (QR codes, invite links, CSRF origin check) |
| `DATABASE_URL` (Docker: `POSTGRES_PASSWORD` etc.) | yes         | PostgreSQL connection                                               |
| `APP_ENCRYPTION_KEY`, `PHONE_HASH_KEY`            | yes         | `openssl rand -base64 32` / `openssl rand -hex 24`                  |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                   | first start | Creates the first super admin when there is no demo data            |
| `TRUST_PROXY`, `COOKIE_SECURE`                    | proxy       | Reverse-proxy and TLS settings                                      |
| `BACKUP_*`                                        | no          | Backup scripts ([docs/backup-restore.md](docs/backup-restore.md))   |
| `SMTP_*`, `WHATSAPP_*`, `SMS_*`, `MESSAGING_*`    | no          | Outgoing mail and visitor messages                                  |

## Deploying on a single office server

The step-by-step guide (clean Ubuntu with Docker, first administrator, TLS reverse proxy, upgrades, rollback, offline install, kiosk screens, sizing) is [docs/deployment.md](docs/deployment.md). In short:

1. Install Docker on a small Linux server on the office LAN with a fixed IP or local DNS name, clone to `/opt/dor`, `cp .env.example .env`, set `APP_URL`, the keys, `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`.
2. `docker compose up -d --build`. The app restarts automatically after reboots and drains cleanly on stop.
3. **TLS:** put Caddy (`docker/Caddyfile.example`) or nginx in front; set `APP_URL=https://...`, `TRUST_PROXY=true`, `APP_BIND=127.0.0.1`.
4. **Backups:** schedule `scripts/backup.sh` nightly (Windows: `scripts/backup.ps1`), copy off the machine, and rehearse the restore ([docs/backup-restore.md](docs/backup-restore.md)). Admin, Overview shows when the last backup ran.
5. **Health:** `GET /api/health` (liveness plus database, used by Docker) and `GET /api/ready` (readiness for uptime monitors). The runbook for common problems is in [docs/operations.md](docs/operations.md).
6. **CI:** `.github/workflows/ci.yml` runs format, lint, typecheck, `npm run verify:deploy`, tests and build, the Playwright suite, a Docker build with a full compose smoke test, and a dependency audit.

Nothing calls a service outside your network at runtime: fonts are bundled, QR codes are generated on the server, and TTS defaults to the browser engine. Optional integrations (SMTP, WhatsApp, cloud TTS) are off until configured.

## Waiting-room screens

1. Sign in as an administrator, open **Admin → Screens → Add screen**, choose the branch and layout (classic, single number, multi-zone), and note the 6-character pairing code (valid 15 minutes).
2. On the TV or mini-PC open `http://<server>:3000/display` in Chrome and type the code (or open `/display?code=ABC123`). The screen stays paired across restarts; revoke it from the same page.
3. Kiosk tips: start Chrome with `--kiosk --autoplay-policy=no-user-gesture-required http://<server>:3000/display` so sound needs no tap. Without that flag, tap the screen once to enable sound. Press **F** (or double click) for fullscreen.
4. **Voice:** Admin → Screens → Voice, in cards: what is announced (call language, default Arabic only; ticket reading "رقم بي، أربعة عشر"), how many times, timing of the pauses, sound, and a test area that plays with the values on the page. The default uses the TV browser's own speech engine; many kiosk PCs have no Arabic voice. In that case install one (Windows: Settings → Time & language → Speech) or use a recorded pack: ten ready Arabic voices ship in `public/audio/ar` with whole-number clips (`ar.num.0…999`), letters and phrases; run `npm run voice:install-arabic` to register them, then choose one in the same tab. Rebuild or extend the clips with `npm run voice:build-clips` and check them with `npm run voice:check-clips` (see decision D54; the licence note of D35 applies).

## Reception speed

Admin → Settings → Reception controls the desk: one-tap issuing, auto-print, whether priority and language are asked, and what happens after a ticket. The visitor details collected (and which are required) are set per visit reason. For printing without the browser dialog, start Chrome on the reception PC with `--kiosk-printing` and set the thermal printer as the default printer.

## Branches without a receptionist

Admin → Cities and Branches show whether each branch has a receptionist, and the overview warns when a branch has no way to issue tickets. Options: (1) agents issue walk-in tickets from their own screen ("New walk-in visitor": Serve now or Add to queue), controlled by Settings → Reception → Agents issuing tickets (default: only when the branch has no receptionist); (2) a self check-in kiosk: Admin → Screens → Add kiosk, type the pairing code on the tablet at `/kiosk`, then turn it on and choose services, wording, printing and limits in Settings → Self check-in (each city or branch can have its own values). A service that needs staff, or whose required details a visitor may not type (set per detail in Visit reasons), appears as "please ask the agent". For silent printing start the kiosk Chrome with `--kiosk-printing`. Decision: D61.

## Halls: several visitors with one agent

A **hall** is a room with a capacity (for example an orientation hall for 12 people) where one agent, the **host**, receives a group of visitors together. This is different from "several visitors per agent" (Settings → Agents), where an agent still serves independent tickets one by one at a desk. Everything is optional and off by default.

1. **Turn it on:** Admin → Settings → Agents & service → **Halls** → _Enable halls_. Like other settings it can be set for the whole organization, one city or one branch. There you also choose whether a group is made of one visit reason or any reason, the smallest and largest group, whether the host may top up a group before it starts, whether the session starts by itself when everybody is in, and how the group is announced (read every number, read ranges such as "from A-014 to A-020", or just "the next group to hall 2").
2. **Create halls:** Admin → Branches → _Halls_ (next to the desks): name in both languages, number (what the screen and voice say), floor, capacity (at least 2), zone, and which services the hall accepts (empty = all hall services).
3. **Mark the services:** Admin → Visit reasons → _Served at: Hall_. Visitors for these services get an ordinary ticket from reception, the kiosk or an appointment, wait in the line (with a position and an estimate based on the hall capacity) and are **never** assigned to a desk agent; desk services never go to a hall.
4. **Hosts:** in the user's agent profile choose _Works at: Hall_ (their usual hall). The host signs in to the hall on the agent screen (a hall or a desk, not both) and sees the **Hall session** panel: capacity gauge, **Call next group** (with a size), the visitors of the group (called, entered, done, no-show; release a visitor back to the queue at their place), _Mark all entered_, _Start session_, _Top up_, _Close session_ (with an outcome) and _Cancel_. One host per hall; a host with an open session cannot go on a break until it is closed.
5. **Screens and voice:** waiting-room screens show a group card ("Hall 2: A-014 · A-015 · A-016") and announce it once: "الأرقام بي أربعة عشر، بي خمسة عشر، وبي ستة عشر، تفضلوا إلى القاعة اثنين". The visitor's phone page says "Your group is called: please go to Hall 2", and the _called_ message can include the hall (`{hall}`).
6. **Reports:** the _Halls_ card and the export section `byHall` show sessions, average group size, occupancy (visitors / capacity), average session length and no-show rate per hall; reports can be filtered by hall. Hall visitors also count in all the usual figures.

Missed visitors follow the same call timeouts as desks; nothing about halls depends on the time of day. Decision: D62.

## Visitor feedback

After a visit is completed, the status page behind the ticket QR asks the visitor to rate it (faces or stars, an optional comment, optionally a "would you recommend us" question). Edit the wording and switches in **Admin → Settings → Feedback**; `/t/<token>/feedback` is a direct link for messages (`{feedbackLink}`). Satisfaction appears in Reports (KPIs, charts, exports), as alerts for low scores, as a wallboard tile and on each agent's own profile. Comments are personal data and follow your retention period (decision D53).

## Privacy and data retention

Personal data is kept only as long as you decide. **Admin → Settings → Security & privacy → Data retention** sets, in days, how long visitor details (name, phone, company), ticket notes and intake answers, feedback comments, message recipients, the audit log and expired sign-in data are kept (0 keeps that kind of data). A job runs about once a day and **anonymises instead of deleting** where reports need the numbers: tickets, scores and totals stay, the person can no longer be identified or re-linked. **Preview** shows what a run would change, **Run now** does it at once. **Admin → Privacy requests** (permission `visitors.privacy`) finds a visitor by phone, name or ticket number, shows what is held, exports it as JSON or CSV for an access request, and erases it on request (reason and confirmation required, no message is sent to them afterwards); city admins only reach visitors of their own branches. A deactivated staff account can be anonymized from the user dialog; their history and the audit log stay intact. Details: decision D56.

## Configuration per city

Settings are inherited: organization default, then the city, then the branch (the most specific wins). In Admin, Settings pick **Applies to: Organization | City | Branch** at the top (a link such as `/admin/settings?scope=city:<id>&section=wifi` opens a level directly). For a city or branch, turn on **Override for this city** on a section to give it its own value (it starts from the current one); turn it off to go back to the inherited value. The badge shows where the value in effect comes from. Company identity (branding), security and data retention are organization-only. A super admin edits every level; a city admin edits their city and its branches; a branch manager edits their branches. Admin, Cities shows what each city overrides, links to its settings and can copy the configuration of another city. A city can also hide visit reasons, have its own shifts and its own message wording (see D60 in `docs/decisions.md`).

## Security

**Reporting a vulnerability.** Please do not open a public issue. Write to the maintainers privately (the address of the project owner in your organization's repository settings) with the steps to reproduce, the version (`/api/health` shows it) and what you could reach; we acknowledge within 3 working days and agree on a fix and a disclosure date. Only the latest release receives fixes.

**What was reviewed.** [docs/security-review.md](docs/security-review.md) lists every finding, what was fixed and what remains, with an inventory of all API routes, their permission and how branch/city scope is enforced; `tests/integration/authz-matrix.test.ts` fails when a new route is public without a stated reason, lacks a permission, or lets another city's data through. Decision D57.

**Hardening checklist for an installation**

1. Generate your own keys: `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`), `PHONE_HASH_KEY` (`openssl rand -hex 24`), a long `POSTGRES_PASSWORD`. In production the server **refuses to start** with the published development keys when `APP_URL` is https or `SEED_DEMO` is not `true`, and warns when it runs a demo.
2. Real installation: `SEED_DEMO=false`, create the first administrator with `ADMIN_EMAIL`/`ADMIN_PASSWORD` (D58), switch on 2FA for administrators (Account) and keep the password policy in Settings, Security.
3. TLS in front (Caddy/nginx, see [docs/deployment.md](docs/deployment.md)); `APP_URL=https://...`, `TRUST_PROXY=true` (and `TRUST_PROXY_HOPS` if more than one proxy), the proxy must **set or append** `X-Forwarded-For`. The server then adds HSTS, `Secure` cookies named `__Host-dor_session`, and upgrades insecure requests.
4. Do not publish the database port; keep the machine and its disk (and backups) encrypted or physically controlled; the backup scripts can encrypt.
5. Restrict who gets organization-wide roles; give city and branch admins only their own scope (they cannot see or change other cities).
6. Keep the host, Docker images and `npm audit` current; run the Docker `HEALTHCHECK`/`/api/ready` monitoring.
7. Review **Admin → Audit log** regularly; failed sign-ins, lockouts (`auth.locked`), cancelled second-factor sign-ins (`auth.totp_locked`), exports and permission changes are recorded.

**Rotating keys.** Stop the application, back up the database, then run
`OLD_APP_ENCRYPTION_KEY=<old> NEW_APP_ENCRYPTION_KEY=$(openssl rand -base64 32) npx tsx scripts/rotate-keys.ts encryption` (re-encrypts the 2FA secrets in one transaction; a wrong old key changes nothing) and/or
`OLD_PHONE_HASH_KEY=<old> NEW_PHONE_HASH_KEY=$(openssl rand -hex 24) npx tsx scripts/rotate-keys.ts phone` (recomputes visitor phone hashes; STOP links in messages already sent stop working). Put the new value in `.env` and start the application. If a session secret leaks, end all sessions by truncating the `sessions` table (everyone signs in again).

## Project layout

```
server.ts               Node entry: Next.js + Socket.IO (+ jobs) in one process
drizzle/                SQL migrations (generated, committed)
messages/{ar,en}.json   UI strings (never inline). Add a language = add a file + src/i18n/locales.ts
src/app/[locale]/       Pages: admin, reception, agent, wallboard, display, login, account
src/app/api/            REST API (v1) and health check
src/domain/             Pure business logic, no I/O (RBAC, Arabic normalization, digits, and later the queue engine)
src/server/             Services: auth, sessions, settings, audit, realtime, rate limiting
src/db/                 Drizzle schema, client, migrations runner, seed
tests/unit, integration Vitest suites
tests/e2e               Playwright browser tests (one private app + database per run)
scripts/load             Load tests (busy morning scenario, thresholds, invariants)
docs/                   Data model, API, decisions
```

## Documentation

- [docs/security-review.md](docs/security-review.md): security review, findings, residual risks, route authorization inventory
- [docs/data-model.md](docs/data-model.md): tables and relationships
- [docs/api.md](docs/api.md): REST endpoints, auth and error format
- [docs/deployment.md](docs/deployment.md): installation, TLS, upgrades, rollback, kiosk screens
- [docs/backup-restore.md](docs/backup-restore.md): backups, restore drill, RPO and RTO
- [docs/operations.md](docs/operations.md): environment variables, logs, monitoring, runbook
- [docs/testing.md](docs/testing.md): test layers, the hermetic databases, running and writing browser tests
- [docs/load-testing.md](docs/load-testing.md): the load scenario, thresholds, measured numbers, tuning
- [docs/decisions.md](docs/decisions.md): architecture decisions and defaults
