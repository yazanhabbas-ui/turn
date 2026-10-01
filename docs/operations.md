# Operations: configuration, logs, monitoring, runbook

## Environment variables

One table for everything the system reads. **Required** means the server does not start (or compose refuses) without it. Put values in `.env` (copy `.env.example`); never commit it. Generate secrets on the server:

```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 24      # PHONE_HASH_KEY and POSTGRES_PASSWORD
```

| Variable                                                                                                                                                                | Required                | Default                                    | Meaning                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                                                                                                                                               | production              | `http://localhost:3000`                    | Address people type. Used for QR codes, invite links and the CSRF origin check. Use `https://` behind a TLS proxy                   |
| `PORT`                                                                                                                                                                  | no                      | `3000`                                     | Port the app listens on (inside the container always 3000; `PORT` is the published port)                                            |
| `APP_BIND`                                                                                                                                                              | no                      | `0.0.0.0`                                  | Docker: host address the port is published on; `127.0.0.1` with a reverse proxy on the host                                         |
| `HOSTNAME`                                                                                                                                                              | no                      | `::`                                       | Bind address of the process (dual-stack; falls back to IPv4)                                                                        |
| `DATABASE_URL`                                                                                                                                                          | yes (Docker builds it)  | `postgres://dor:dor@localhost:5432/dor`    | PostgreSQL 15+ connection string                                                                                                    |
| `DATABASE_POOL_MAX`                                                                                                                                                     | no                      | `20`                                       | Maximum database connections of the app                                                                                             |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                                                                                                                   | password: production    | `dor` / `dor` / `dor`                      | Docker db container. The production file requires `POSTGRES_PASSWORD`                                                               |
| `APP_ENCRYPTION_KEY`                                                                                                                                                    | yes                     | -                                          | 32 random bytes, base64. Encrypts 2FA secrets. Losing or changing it invalidates every enrolled 2FA                                 |
| `PHONE_HASH_KEY`                                                                                                                                                        | yes                     | -                                          | Random string, 16+ characters. Keys the visitor phone hash and STOP links                                                           |
| `REDIS_URL`                                                                                                                                                             | no                      | -                                          | Redis for several app nodes (realtime, rate limits). Empty = in-memory, single node                                                 |
| `SESSION_TTL_HOURS`                                                                                                                                                     | no                      | `12`                                       | Sign-in session lifetime                                                                                                            |
| `TRUST_PROXY` / `TRUST_PROXY_HOPS`                                                                                                                                      | with a proxy            | `false` / `1`                              | Trust `X-Forwarded-For` from this many reverse proxies                                                                              |
| `COOKIE_SECURE`                                                                                                                                                         | no                      | `auto`                                     | `auto` = Secure cookies when `APP_URL` is https                                                                                     |
| `LOG_LEVEL`                                                                                                                                                             | no                      | `info`                                     | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                                                                  |
| `SHUTDOWN_TIMEOUT_SECONDS`                                                                                                                                              | no                      | `20`                                       | Graceful shutdown limit before the process exits anyway (compose waits 30 s)                                                        |
| `LOG_MAX_SIZE` / `LOG_MAX_FILE`                                                                                                                                         | no                      | `10m` / `5`                                | Docker container log rotation                                                                                                       |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                                                                                                                        | first start, production | -                                          | Creates the first super admin if missing (`ADMIN_NAME_AR`, `ADMIN_NAME_EN`, `ORG_NAME_AR`, `ORG_NAME_EN`, `SEED_ORG_SLUG` optional) |
| `SEED_DEMO` / `SEED_PASSWORD`                                                                                                                                           | no                      | `true` (base) / `false` (prod)             | Demo organization and its password. Never in production                                                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`                                                                                      | no                      | port 587                                   | Outgoing mail (invites, scheduled reports, visitor e-mail)                                                                          |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_API_URL`                                                                                       | no                      | `v21.0`, Meta graph URL                    | WhatsApp Cloud API for visitor messages                                                                                             |
| `SMS_PROVIDER`, `SMS_URL`, `SMS_METHOD`, `SMS_AUTH_HEADER`, `SMS_BODY_FORMAT`, `SMS_BODY`, `SMS_FROM`, `SMS_MESSAGE_ID_PATH`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | no                      | -                                          | SMS gateway (`http` or `twilio`)                                                                                                    |
| `MESSAGING_MOCK`, `MESSAGING_TIMEOUT_SECONDS`                                                                                                                           | no                      | `false`, `15`                              | Record messages instead of sending; provider request timeout                                                                        |
| `BACKUP_*`                                                                                                                                                              | no                      | see [backup-restore.md](backup-restore.md) | Backup scripts; `BACKUP_DIR` and `BACKUP_MAX_AGE_HOURS` are also read by the app for the Overview indicator                         |
| `COMPOSE_FILE`                                                                                                                                                          | production              | -                                          | `docker-compose.yml:docker-compose.prod.yml` so plain `docker compose` uses the production files                                    |

`npm run verify:deploy` fails when a variable used by compose or by `src/server/env.ts` is missing from `.env.example`, so the file stays the complete list.

## Health and readiness

| Endpoint          | Meaning                                                                                                                                                                                                                                             | Use                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/health` | `200` when the process answers and the database responds; `503 degraded` otherwise                                                                                                                                                                  | Docker `HEALTHCHECK`                                      |
| `GET /api/ready`  | `200` when the database answers, migrations are applied and the process is not draining. Body: `status` (`ok`, or `degraded` when the background worker is not running and jobs run inline), `database`, `migrated`, `jobs`, `realtime`, `draining` | Uptime monitor, reverse proxy health check, load balancer |

Both return JSON with `Cache-Control: no-store` and need no sign-in. After `SIGTERM` (`docker stop`, upgrades) `/api/ready` answers `503 not_ready` while the server finishes running requests and closes cleanly.

## Logs

- **Format:** one JSON object per line (pino): `level` (30 info, 40 warn, 50 error, 60 fatal), `time` (ISO), `service`, `msg` plus fields. The logger redacts `password`, `token`, `phone`, `email`, authorization and cookie fields and the code logs identifiers, not names, phone numbers or e-mails; visitor contact data never appears in logs (notification logs store masked recipients). Treat logs as internal anyway.
- **Where:** Docker: `docker compose logs -f app` (rotating `json-file`, 10 MB x 5 by default, files under `/var/lib/docker/containers/`). Without Docker: standard output of the process (journald under systemd). Database logs: `docker compose logs db`.
- **Useful filters:** `docker compose logs app | grep '"level":50'` (errors); `... | grep SECURITY` (configuration warnings at start-up); `... | grep migration`.
- **Backups:** `/var/log/dor-backup.log` (cron) or the journal; `backups/last-success.json` and `last-failure.json`.

## Monitoring suggestions

| Check              | How                                                                                      | Alert when                         |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Is it up and ready | HTTP check on `https://<APP_URL>/api/ready` every 30-60 s (Uptime Kuma, Zabbix, Nagios)  | not `200` for 2 consecutive checks |
| Container state    | `docker compose ps` / `docker inspect --format '{{.State.Health.Status}}'`               | `unhealthy` or restarting          |
| Disk               | `df -h /var/lib/docker /opt/dor/backups`                                                 | over 80 % used                     |
| Backup age         | Admin, Overview indicator, or `backups/last-success.json` `finishedAt`                   | older than 36 hours                |
| Database size      | `docker compose exec db psql -U dor -c "select pg_size_pretty(pg_database_size('dor'))"` | grows unexpectedly                 |
| Certificate expiry | the reverse proxy / an HTTPS check                                                       | under 14 days                      |
| Memory             | `docker stats --no-stream`                                                               | app near its 1.5 GB limit          |

## Runbook: symptom, cause, fix

**The TV shows "reconnecting".**
The screen lost its realtime connection and retries by itself. 1) Open `https://<APP_URL>/api/ready` from the TV's network: if it fails, the server or the network is down (`docker compose ps`, `docker compose logs --tail=100 app`). 2) If it works in a normal browser but not behind your proxy: the proxy does not upgrade WebSockets or times out idle connections; set `Upgrade`/`Connection` headers and `proxy_read_timeout 3600s` (deployment.md). Socket.IO falls back to long-polling, so a blocked WebSocket shows up as slow updates, not as nothing. 3) `APP_URL` differs from the address the TV uses: fix `APP_URL`. 4) After a server restart screens reconnect within a few seconds; if one does not, reload it (F5 in kiosk) and, if it asks for pairing, pair it again in Admin, Screens.

**No sound on the screen.**
Chrome blocks audio until the page has been touched: start the kiosk with `--autoplay-policy=no-user-gesture-required`, or tap the screen once. Check Admin, Screens, Voice: volume above zero, a voice or "browser speech" chosen, "Test" plays. If using the browser's own speech, the TV PC needs an Arabic voice installed (Windows: Settings, Time and language, Speech); otherwise use the bundled recorded voices. Check the HDMI/system output volume and that the right audio output device is the default.

**Tickets are not printing.**
Reception printing uses the browser's print dialog: start Chrome with `--kiosk-printing` and set the thermal printer as the OS default printer. Test a normal page print first. If the QR code is missing, check `APP_URL`. Paper size is set in the printer driver (80 mm roll).

**People cannot sign in / "bad origin" errors on every action.**
`APP_URL` must match the address in the browser exactly (scheme, host, port). Behind a TLS proxy set `APP_URL=https://...`, `TRUST_PROXY=true`. After changing `.env`: `docker compose up -d`.

**The app will not start: "Refusing to start with insecure configuration".**
The production configuration still contains a published development key or the demo setup. Generate real `APP_ENCRYPTION_KEY` / `PHONE_HASH_KEY` (table above) and set `SEED_DEMO=false`. Do not change `APP_ENCRYPTION_KEY` on a system with data unless you accept that every user must re-enrol two-factor authentication.

**Migrations fail at start (container restarts, logs show "migration failed").**
`docker compose logs app | grep -B2 -A10 migration`. Typical causes: the database is not UTF-8 ("Database encoding is ... UTF8 is required": recreate the database with `ENCODING 'UTF8' TEMPLATE template0`, restore from backup), the disk is full, or a hand-edited schema. Migrations run in transactions, so a failed one leaves the previous state. Roll the code back to the previous tag (deployment.md, section 7) and report the log. Never delete rows from the `drizzle.__drizzle_migrations` table by hand.

**The database disk is full.**
`df -h`, `docker system df`. Free space first: `docker system prune -f` (unused images/containers, not volumes), delete old backups copied off-site, `docker compose logs` rotation is already limited. Then find the cause: `psql` `select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 10;`. Large tables are tickets and events; shorten the retention periods in Admin, Settings, Privacy (this also deletes personal data on schedule). `VACUUM FULL` needs free space equal to the table, so free disk first. If PostgreSQL stopped because the disk filled, free space then `docker compose up -d`; it recovers by itself.

**`/api/ready` says `degraded` / `jobs: inline`.**
The background worker (pg-boss) could not start; the app keeps working and runs jobs inline, so visitor messages are sent synchronously and retries happen at once. Look for "background jobs failed to start" in the log (usually a database permission or connection problem), fix it and restart the app.

**The Overview shows "Backup is overdue" or "Last backup failed".**
Run `scripts/backup.sh` by hand and read the output; check `backups/last-failure.json`, free disk, that the db container is running, and the cron/timer (`systemctl status dor-backup.timer`, `grep CRON /var/log/syslog`). The card clears itself after the next successful run. If it says "No backup recorded" in Docker, check that `./backups` exists and is the folder `BACKUP_DIR` points to.

**Everything is slow.**
`docker stats`: if the app is at its memory limit it restarts; raise the limit in `docker-compose.prod.yml` or reduce screens polling; if the db is busy, check `docker compose exec db psql -U dor -c "select state, count(*) from pg_stat_activity group by 1"` and `DATABASE_POOL_MAX`. A very old browser on the TV is the most common cause of a slow display.

**The server clock is wrong.**
Ticket times and reports use the server's clock (UTC in containers, branch time zones for display). Fix NTP on the host (`timedatectl`); do not change the container time.

**Restoring after a disaster:** see [backup-restore.md](backup-restore.md); the sequence is Docker install, code at the right tag, `.env` from the vault, `docker compose up -d db`, `scripts/restore.sh <backup>`, `docker compose up -d`.
