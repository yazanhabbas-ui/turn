# Backup and restore

## What is backed up

**Everything lives in the PostgreSQL database**: organization, users, roles, settings, tickets and history, reports data, and the uploaded images (the organization logo, the dark-background logo and user avatars are stored as `bytea` rows). A database dump is therefore the complete backup; there is no separate uploads folder to copy.

Not in the database, and to be kept separately: `.env` (above all `APP_ENCRYPTION_KEY`, which decrypts the two-factor secrets, and `PHONE_HASH_KEY`) and your reverse-proxy configuration and certificates. Store a copy of `.env` in your password manager or vault, not next to the database backups.

## Two tools, two formats

| Installation                       | Script                                                             | Format                                                     | Needs                             |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------- |
| Docker Compose (production)        | `scripts/backup.sh`, `scripts/restore.sh`                          | `pg_dump` custom format, `dor-<UTC stamp>.dump`            | Docker (runs in the db container) |
| `npm run local`, Windows, any host | `scripts/backup.ps1`, `restore.ps1` (wrap `scripts/db-backup.mjs`) | Dor logical backup, `dor-<UTC stamp>.dorbak` (gzip NDJSON) | Node.js only                      |

The bundled PostgreSQL of `npm run local` ships no `pg_dump`, which is why the second tool exists. Files of one format cannot be restored with the other tool. Both write a `.sha256` file next to the backup and `backups/last-success.json`, which Admin, Overview shows as "Database backup" (green: backed up; red: overdue after `BACKUP_MAX_AGE_HOURS`, default 36, or the last run failed). In Docker, `./backups` is mounted read-only into the app container for this.

`npm run backup`, `npm run backup:verify -- <file>` and `npm run restore -- <file>` are shortcuts for the Node tool.

## Taking backups

```bash
scripts/backup.sh                     # Docker installation
powershell -File scripts\backup.ps1   # Windows / npm run local
```

Each run: dump (a consistent snapshot, no downtime, never modifies the data) then verify (`pg_restore --list` / file re-read with per-table counts) then checksum, optional restore test, optional encryption, retention, `last-success.json`, optional upload hook.

| Variable (environment)     | Default          | Meaning                                                                            |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `BACKUP_DIR`               | `./backups`      | destination                                                                        |
| `BACKUP_KEEP_DAYS`         | 14               | daily files older than this are deleted                                            |
| `BACKUP_KEEP_WEEKLY`       | 8                | the Sunday backup is also copied to `weekly/`; the newest N are kept               |
| `BACKUP_VERIFY_RESTORE`    | off              | `1`: also restore into a scratch database, compare tables (and counts), drop it    |
| `BACKUP_ENCRYPT` (sh)      | `none`           | `openssl` (needs `BACKUP_PASSPHRASE`) or `age` (needs `BACKUP_AGE_RECIPIENT`)      |
| `BACKUP_PASSPHRASE` (node) | -                | setting it encrypts with AES-256-GCM (scrypt); required again to verify or restore |
| `BACKUP_UPLOAD_CMD`        | -                | shell command after success, with `BACKUP_FILE` and `BACKUP_CHECKSUM_FILE` set     |
| `COMPOSE` (sh)             | `docker compose` | add `-f` options if you do not use `COMPOSE_FILE`                                  |

**Encryption.** Backups contain personal data and password hashes: encrypt any copy that leaves the server. Use a passphrase of 20+ characters, keep it in the vault, and **test that you can decrypt** during the drill. Losing the passphrase loses the backup. Decrypting an openssl backup by hand: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in X.dump.enc -out X.dump`.

**Off-site copy (documented, not required).** Examples for `BACKUP_UPLOAD_CMD`:

```bash
BACKUP_UPLOAD_CMD='rclone copy "$BACKUP_FILE" "$BACKUP_CHECKSUM_FILE" remote:dor-backups/'
BACKUP_UPLOAD_CMD='scp "$BACKUP_FILE" "$BACKUP_CHECKSUM_FILE" backup@nas.office.local:/srv/dor/'
```

A failing hook exits with code 4 (the local backup is intact) so that monitoring sees it.

**Exit codes** (cron mail, systemd, monitoring): `0` ok, `1` dump failed, `2` verification failed, `3` encryption failed (sh) / upload failed (node), `4` upload failed (sh), `64` bad configuration. Every line is timestamped and goes to stdout (errors to stderr); a failed run writes `last-failure.json`.

### Scheduling

Linux with cron (02:30 every night, log to a file):

```
30 2 * * * cd /opt/dor && BACKUP_VERIFY_RESTORE=1 BACKUP_UPLOAD_CMD='...' scripts/backup.sh >> /var/log/dor-backup.log 2>&1
```

Linux with a systemd timer (gives you `systemctl status`, journal logs and `OnFailure=`):

```ini
# /etc/systemd/system/dor-backup.service
[Service]
Type=oneshot
WorkingDirectory=/opt/dor
EnvironmentFile=-/etc/dor-backup.env      # BACKUP_* variables, mode 600
ExecStart=/opt/dor/scripts/backup.sh
# /etc/systemd/system/dor-backup.timer
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

Windows (Task Scheduler): `schtasks /Create /SC DAILY /ST 02:30 /TN "Dor backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dor\scripts\backup.ps1"`. The task runs with the user's rights; the PostgreSQL of `npm run local` must be running (the app is running).

The nightly time is only when the backup job runs; the queue itself is never paused for it.

## RPO and RTO

- **RPO (data you can lose):** up to the interval between backups. Nightly backup: up to ~24 h of tickets and configuration changes. The queue is operational data (a day of tickets), so most offices accept this. For less, run the script every 1-4 hours (a dump takes seconds to a minute at this size, with no downtime); the retention settings then keep more files, so adjust `BACKUP_KEEP_DAYS`. Continuous protection (WAL archiving) is possible with PostgreSQL but is not set up by this project.
- **RTO (time to be back):** with the drill below practised: 15-30 minutes on the same server (install Docker image, restore, start). On new hardware add the OS install and `.env` recovery: plan 1-2 hours. Measure your own number in the first drill.

## Restoring

Always stop users from working first (tell reception), and keep the file you are restoring from untouched.

```bash
scripts/restore.sh backups/dor-20261001T023000Z.dump          # type "restore" to confirm (or add --yes)
# encrypted: BACKUP_PASSPHRASE=... scripts/restore.sh backups/dor-....dump.enc
```

`restore.sh` verifies the checksum, decrypts, checks the archive, stops the app, restores in a single transaction (all-or-nothing: on error the database is left as it was) and starts the app, which applies newer migrations on start. Restore a backup into the **same or a newer** app version, never an older one.

Windows / local mode: stop the app, start only the database (`npm run local -- --db`), then:

```powershell
powershell -File scripts\restore.ps1 backups\dor-20261001T023000Z.dorbak
```

The Node restore refuses to run if the schema version of the target differs from the backup (it tells you which version to run), empties the tables and loads the rows in one transaction, and resets the sequences. It needs a database superuser (the bundled one is).

To restore into a scratch database instead of the live one (inspection, drills): `node scripts/db-backup.mjs restore <file> --target-url postgres://user:pw@host:5433/dor_scratch --migrate --yes` (an empty database is created and migrated for you with `--migrate`).

## Restore drill checklist (do it once now, then monthly)

1. Pick the newest backup; note its date and size. Check `backups/last-success.json` is younger than 36 h.
2. Verify the file: `sha256sum -c backups/<file>.sha256` (or `npm run backup:verify -- backups/<file>`).
3. If encrypted: decrypt with the passphrase **from the vault**, not from memory or shell history.
4. Restore into a **scratch** target (a second compose project `docker compose -p dortest ...` on another port, or a scratch database), not the live system. `BACKUP_VERIFY_RESTORE=1 scripts/backup.sh` automates the database part.
5. Start the app against it, sign in as an administrator, and check: users and roles are there, today's tickets, the logo, an avatar, a report for last week, and that two-factor sign-in works for a user who has it (proves `APP_ENCRYPTION_KEY` matches).
6. Record: time it took (your real RTO), problems found, who did it. Drop the scratch target.
7. Once a year: restore on a different machine from only the off-site copy plus the vault, to prove you do not depend on anything left on the old server.

## Monthly test routine

Once a month, 30 minutes: run the drill above; check free disk space (`df -h`, `docker system df`) and that `backups/weekly` holds the expected number of files; confirm the off-site copy is current (date of the newest remote file); glance at Admin, Overview for the backup indicator; rotate nothing else. Write the date in your operations log.
