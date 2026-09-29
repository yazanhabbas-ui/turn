# Dor (دور): visitor queue and turn distribution

An Arabic-first, fully bilingual (AR/EN) system for in-office visitor queues. Reception issues tickets by visit reason, the system routes them to agents according to admin-configured rules, a waiting-room screen calls numbers with voice announcements, and admins get KPIs.

It runs entirely on your own server (on-premises or a regional cloud), keeps working on the office LAN without internet, and sends no data to third parties.

> **Status:** Milestone 1 (foundation) is complete: schema, auth with 2FA, RBAC, AR/EN with RTL, seed data, Docker. See [docs/decisions.md](docs/decisions.md) for the milestone plan.

## Quick start (Docker, recommended)

Requirements: Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).

```bash
cp .env.example .env        # then set APP_ENCRYPTION_KEY and PHONE_HASH_KEY (see below)
docker compose up -d        # builds the app, starts Postgres, migrates, seeds demo data
```

Open <http://localhost:3000> and sign in:

| Account                | Role                  | Password (demo) |
| ---------------------- | --------------------- | --------------- |
| `admin@dor.local`      | Administrator         | `Dor@Demo2026`  |
| `supervisor@dor.local` | Supervisor (custom)   | `Dor@Demo2026`  |
| `reception@dor.local`  | Receptionist          | `Dor@Demo2026`  |
| `khalid@dor.local` …   | Agent (5 demo agents) | `Dor@Demo2026`  |

**Change these passwords before real use**, or set `SEED_DEMO=false` and create your own admin (see _Production_ below).

Generate the two secrets:

```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 24      # PHONE_HASH_KEY
```

Without a `.env`, Compose uses built-in development keys so a clean machine still starts. Never use those in production.

## Local development

Requirements: Node.js 22+ and PostgreSQL 15+ (easiest: `docker compose up -d db`).

```bash
npm install
cp .env.example .env         # set the two keys; DATABASE_URL points at localhost:5432
npm run db:migrate
npm run db:seed              # idempotent; `npm run db:reset` wipes and re-seeds (dev only)
npm run dev                  # http://localhost:3000 with hot reload (Next.js + Socket.IO in one process)
```

| Script                                  | Purpose                                                 |
| --------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                           | Dev server (`server.ts` via tsx watch)                  |
| `npm run build` / `npm start`           | Production build / start                                |
| `npm test`                              | Unit + integration tests (integration uses `<db>_test`) |
| `npm run test:unit`                     | Unit tests only (no database needed)                    |
| `npm run lint` / `typecheck` / `format` | Quality gates (also run in CI)                          |
| `npm run db:generate`                   | Create a SQL migration after editing `src/db/schema`    |
| `npm run db:migrate` / `db:seed`        | Apply migrations / seed                                 |

Integration tests **truncate tables**. They always run against a separate database (`TEST_DATABASE_URL`, or the dev database name + `_test`), and they create it automatically.

## Environment variables

See [.env.example](.env.example) for the full, commented list.

| Variable                       | Required | Description                                                                         |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| `APP_URL`                      | yes      | URL browsers use to reach the server on the LAN (QR codes and invite links use it)  |
| `DATABASE_URL`                 | yes      | PostgreSQL connection string                                                        |
| `APP_ENCRYPTION_KEY`           | yes      | 32 bytes, base64: encrypts 2FA secrets at rest                                      |
| `PHONE_HASH_KEY`               | yes      | Keys the visitor phone hash (returning-visitor routing without storing numbers)     |
| `REDIS_URL`                    | no       | Enables Redis for multi-node realtime and rate limiting; in-memory otherwise        |
| `SMTP_*`                       | no       | Outgoing mail for invites and reports; without it, invite links are copied manually |
| `TRUST_PROXY`, `COOKIE_SECURE` | no       | Reverse-proxy and TLS settings                                                      |
| `SEED_DEMO`, `SEED_PASSWORD`   | no       | Docker: seed the demo organization on start                                         |

## Deploying on a single office server

1. Install Docker on a small Linux server or mini-PC on the office LAN. Give it a fixed IP or a local DNS name, e.g. `queue.office.local`.
2. Clone this repository to `/opt/dor`, `cp .env.example .env`, and set `APP_URL=http://queue.office.local:3000`, the two keys, a strong `POSTGRES_PASSWORD`, and `SEED_DEMO=false` (or keep it for a trial).
3. Run `docker compose up -d`. The app restarts automatically after reboots (`restart: unless-stopped`).
4. **TLS (recommended):** put Caddy or Nginx in front with an internal certificate, then set `APP_URL=https://…` and `TRUST_PROXY=true`. Browsers need HTTPS for some features (installing the PWA, wake-lock on displays, web push).
5. **Backups:** schedule `scripts/backup.sh` nightly (cron example in the script). Copy `backups/` off the machine. Restore with `scripts/restore.sh <file>`.
6. **Health:** `GET /api/health` returns `200 {"status":"ok"}` when the app and database are up. Docker uses it as the container healthcheck.

Nothing calls a service outside your network at runtime: fonts are bundled, QR codes are generated on the server, and TTS defaults to the browser engine. Optional integrations (SMTP, WhatsApp, cloud TTS) are off until configured.

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
docs/                   Data model, API, decisions
```

## Documentation

- [docs/data-model.md](docs/data-model.md): tables and relationships
- [docs/api.md](docs/api.md): REST endpoints, auth and error format
- [docs/decisions.md](docs/decisions.md): architecture decisions and defaults
