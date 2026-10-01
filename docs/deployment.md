# Deployment guide

Dor runs as two containers (the app and PostgreSQL 16) on one small Linux server on the office network. The app image contains Next.js, the Socket.IO realtime hub and the background jobs (pg-boss) in one process. Nothing calls a service outside your network at runtime.

> **Status of this guide.** The files (Dockerfile, compose, scripts) were written and checked statically (`npm run verify:deploy`) and the application start-up, first-admin bootstrap and backup tooling were run on a Windows machine without Docker. `docker compose up` itself has **not** been run by the author: the `docker` job of the CI workflow (`.github/workflows/ci.yml`) builds the image and runs the whole production stack on every push, and the first install on a real server is the final proof. See decision D58.

## 1. Sizing

| Load                                     | CPU     | RAM   | Disk                                                             |
| ---------------------------------------- | ------- | ----- | ---------------------------------------------------------------- |
| One branch, up to ~15 desks, 2-3 screens | 2 vCPU  | 4 GB  | 20 GB SSD                                                        |
| Several branches, ~50 desks, ~10 screens | 4 vCPU  | 8 GB  | 40 GB SSD                                                        |
| Larger, or several app nodes             | 8+ vCPU | 16 GB | 100 GB (several nodes need `REDIS_URL`; start the Redis profile) |

The app uses about 300-600 MB in normal operation (limit in `docker-compose.prod.yml`: 1.5 GB), PostgreSQL 200-500 MB. The database grows by roughly 1 KB per ticket event: a branch issuing 500 tickets a day adds a few hundred MB per year. Voice clips (40 MB) and fonts are in the image, not in the database. Keep backups on a different disk or machine.

## 2. Install on a clean Ubuntu server (22.04 / 24.04)

```bash
# 1. Docker Engine + Compose v2 (official repository)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version            # must print v2.24 or newer

# 2. The code (use a release tag in production)
sudo mkdir -p /opt/dor && sudo chown $USER /opt/dor
git clone <your repository URL> /opt/dor && cd /opt/dor
mkdir -p backups                  # create it yourself: Docker would create it as root otherwise

# 3. Configuration
cp .env.example .env
chmod 600 .env
```

Edit `.env` (every variable is described in [operations.md](operations.md#environment-variables)). The minimum for production:

```bash
APP_URL=https://queue.example.com          # exactly what people type in the browser
POSTGRES_PASSWORD=$(openssl rand -hex 24)  # run the commands and paste the results
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
PHONE_HASH_KEY=$(openssl rand -hex 24)
ADMIN_EMAIL=you@example.com                # the first super admin (see 3.)
ADMIN_PASSWORD='a-long-passphrase-1A'      # min. 10 characters with upper case, lower case and a digit
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

**Back up `.env` separately and safely.** `APP_ENCRYPTION_KEY` encrypts the two-factor secrets in the database: a database backup restored without the same key loses every user's 2FA enrolment. `PHONE_HASH_KEY` is the key of the visitor phone hashes: a different key breaks returning-visitor recognition.

With `COMPOSE_FILE` set, plain `docker compose ...` commands use the production file. Without it add `-f docker-compose.yml -f docker-compose.prod.yml` to every command. The production file has **no default** for any secret: a missing value stops compose with a message naming it, and the application itself refuses to start in production with the published development keys (security review).

```bash
docker compose up -d --build      # first build takes a few minutes
docker compose ps                 # app and db should become "healthy"
docker compose logs -f app        # "Dor ready on https://..."
curl -fsS http://127.0.0.1:3000/api/ready
```

## 3. First run: the first administrator (no demo data)

With `SEED_DEMO=false` (forced by the production file) the database starts empty. If `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, the container creates, on every start and only if missing, the organization and a **super admin** with that e-mail: it never changes an existing account. Sign in at `APP_URL`, then in the admin area create the city, branch, desks, visit reasons, roles and users. The password variables can be removed from `.env` afterwards (the account stays); change the password in your profile.

Other ways to do it:

```bash
# Create (or recover) the admin by hand, on the server:
docker compose run --rm -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='...' app node --import tsx src/db/bootstrap-admin.ts
# Locked out? Replace the password of the existing account:
docker compose run --rm -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='...' app node --import tsx src/db/bootstrap-admin.ts --reset-password
# Without Docker (npm run local or a native install):  ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
```

For a trial with demo accounts use the base file only (`SEED_DEMO=true`, the default): see the README. Do not mix demo and real data.

## 4. Ports, addresses and TLS

| Port | What                | Exposure                                                                    |
| ---- | ------------------- | --------------------------------------------------------------------------- |
| 3000 | the app (HTTP + WS) | `APP_BIND` + `PORT`; bind `127.0.0.1` when a reverse proxy runs on the host |
| 443  | reverse proxy (TLS) | the only port the LAN needs                                                 |
| 5432 | PostgreSQL          | **not published** in the base/production files                              |

Browsers need HTTPS for the installable app (PWA), wake-lock on screens and secure cookies. Put a reverse proxy in front:

1. `.env`: `APP_URL=https://queue.example.com`, `TRUST_PROXY=true`, `TRUST_PROXY_HOPS=1` (one proxy), `APP_BIND=127.0.0.1`. **`APP_URL` must be exactly the address people use**: mutating requests are only accepted from that origin (CSRF protection), and QR codes and invite links are built from it.
2. Caddy (simplest, automatic certificates): copy `docker/Caddyfile.example`, replace the name, run `caddy run`. For an office network without a public name use `tls internal` and install Caddy's root certificate on the PCs and TVs (or use your company CA).
3. nginx instead of Caddy: WebSocket upgrade and forwarded headers are required.

```nginx
server {
  listen 443 ssl http2;
  server_name queue.example.com;
  ssl_certificate     /etc/ssl/dor/fullchain.pem;
  ssl_certificate_key /etc/ssl/dor/privkey.pem;
  client_max_body_size 10m;                      # logo / avatar uploads

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;    # Socket.IO WebSocket
    proxy_set_header Connection        $connection_upgrade;
    proxy_read_timeout 3600s;                            # long-lived realtime connections
  }
}
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

Change of address later: edit `APP_URL`, `docker compose up -d`; printed QR codes made with the old address keep pointing there.

## 5. Waiting-room screens, reception and kiosks

- **TV or mini-PC:** Chrome in kiosk mode, opened on the display URL, paired once with the 6-character code from Admin, Screens:

  ```
  chrome --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars --user-data-dir=/opt/dor-kiosk https://queue.example.com/display
  ```

  `--autoplay-policy=no-user-gesture-required` lets the voice and chime play without a tap. Add the shortcut to the OS start-up so the screen returns after a power cut; the pairing survives restarts. Windows: a shortcut in `shell:startup` with the same command line (`chrome.exe` instead of `chrome`).

- **Reception printing without the browser dialog:** start Chrome on the reception PC with `--kiosk-printing` and make the thermal printer the default printer.
- **Voice:** the TV browser needs an Arabic voice, or use the bundled recorded voices (Admin, Screens, Voice).
- **Time:** the server and the screens only need correct clocks for log timestamps; the service never blocks issuing or calling by time of day.

## 6. Upgrading

```bash
cd /opt/dor
scripts/backup.sh                          # always take a backup first (see backup-restore.md)
git fetch --tags && git checkout <new tag> # or: git pull
docker compose build                       # the old containers keep running during the build
docker compose up -d                       # recreates the app: it applies new migrations on start
docker compose logs -f app                 # wait for "Dor ready"
curl -fsS http://127.0.0.1:3000/api/ready
```

Migrations run automatically at container start and only move forward. The app is unavailable for roughly 10-40 seconds while it restarts; open screens and reception tabs reconnect on their own (the server drains cleanly on `docker compose up -d`/`stop`: it reports not-ready, closes sockets and finishes running requests, up to `SHUTDOWN_TIMEOUT_SECONDS`).

## 7. Rollback

Migrations are not reversible, so rolling back the code means rolling back the data too:

1. `docker compose stop app`
2. `git checkout <previous tag>` and `docker compose build`
3. `scripts/restore.sh backups/<the backup taken before the upgrade>` (stops the app, restores, starts it)
4. `docker compose up -d`; check `/api/ready`.

Tickets issued after that backup are lost, so decide quickly after an upgrade. If the new version only misbehaves cosmetically, prefer fixing forward. If the new version fails to start because of a migration, the database was left at the previous state of that migration (each runs in a transaction): fix or roll back the code, nothing needs restoring.

## 8. Offline and air-gapped installs

- The image makes **no network access at runtime**: fonts, voice clips, QR codes and charts are bundled or generated locally. E-mail, WhatsApp and SMS need their providers and are optional; with `MESSAGING_MOCK=true` messages are only recorded.
- Building needs internet (npm registry, Docker Hub). On a machine with internet: `docker compose build && docker pull postgres:16-alpine`, then `docker save dor-queue:latest postgres:16-alpine | gzip > dor-images.tar.gz`. On the server: `gunzip -c dor-images.tar.gz | docker load`, then `docker compose up -d --no-build`. Copy `.env`, `docker-compose*.yml` and `scripts/` along (the repository checkout is enough).
- Clocks: use the office NTP server or chrony; there is no dependency on external time.

## 9. Without Docker

`npm run local` (README) bundles PostgreSQL and is meant for a single PC and for development. For a server without Docker install Node 22 and PostgreSQL 15+ natively, set `DATABASE_URL`, run `npm ci && npm run build && npm run db:migrate`, create the admin with `npm run admin:create`, and run `npm start` under systemd (`Restart=always`, `KillSignal=SIGTERM`, `TimeoutStopSec=40`). Use `scripts/backup.sh` with `BACKUP_DIRECT_URL` (needs `pg_dump` on the host) or `node scripts/db-backup.mjs backup` (needs only Node).
