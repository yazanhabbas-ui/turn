#!/bin/sh
# Database backup for the Docker Compose installation (POSIX sh). Designed for cron / systemd timers.
#
#   scripts/backup.sh
#
# What it does: pg_dump in custom format (compressed) from the db container, checks it with `pg_restore --list`,
# writes a sha256 file, optionally restores it into a scratch database and compares the tables, optionally
# encrypts it, applies retention, writes backups/last-success.json (shown in Admin -> Overview) and runs an
# optional upload hook. Uploaded logos and avatars are stored IN the database, so the dump is the complete backup.
#
# Environment (all optional):
#   BACKUP_DIR              where files go (default ./backups)
#   BACKUP_KEEP_DAYS        daily files kept (default 14)         BACKUP_KEEP_WEEKLY  Sunday copies kept (default 8)
#   BACKUP_VERIFY_RESTORE=1 also restore into a scratch database and compare the table list and row counts
#   BACKUP_ENCRYPT          none (default) | openssl | age
#   BACKUP_PASSPHRASE       passphrase for openssl (AES-256-CBC, PBKDF2); BACKUP_AGE_RECIPIENT for age
#   BACKUP_UPLOAD_CMD       shell command run at the end with BACKUP_FILE and BACKUP_CHECKSUM_FILE set,
#                           e.g. 'rclone copy "$BACKUP_FILE" remote:dor-backups/'  or  'scp "$BACKUP_FILE" user@host:/srv/dor/'
#   COMPOSE                 compose command (default "docker compose"); add -f files for the prod override, e.g.
#                           COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
#   BACKUP_DIRECT_URL       back up a PostgreSQL reachable from this host with pg_dump instead of the db container
#
# Exit codes: 0 ok | 1 dump failed | 2 verification failed | 3 encryption failed | 4 upload failed (local backup is fine)
#             64 bad configuration.
# Cron example (02:30 every night):  30 2 * * * /opt/dor/scripts/backup.sh >> /var/log/dor-backup.log 2>&1
set -eu
umask 077
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-${KEEP_DAYS:-14}}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
ENCRYPT="${BACKUP_ENCRYPT:-none}"
COMPOSE="${COMPOSE:-docker compose}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
START="$(date +%s)"
NAME="dor-$STAMP.dump"

log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"; }
fail() {
  code="$1"; shift
  log ERROR "$*" >&2
  printf '{"ok":false,"at":"%s","error":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$*" | tr '"\\' "''")" >"$BACKUP_DIR/last-failure.json" 2>/dev/null && chmod 644 "$BACKUP_DIR/last-failure.json" || true
  rm -f "$PLAIN.partial" 2>/dev/null || true
  exit "$code"
}

mkdir -p "$BACKUP_DIR"
PLAIN="$BACKUP_DIR/$NAME"

case "$ENCRYPT" in
  none) ;;
  openssl) [ -n "${BACKUP_PASSPHRASE:-}" ] || fail 64 "BACKUP_ENCRYPT=openssl needs BACKUP_PASSPHRASE"; command -v openssl >/dev/null || fail 64 "openssl not found" ;;
  age) [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || fail 64 "BACKUP_ENCRYPT=age needs BACKUP_AGE_RECIPIENT"; command -v age >/dev/null || fail 64 "age not found" ;;
  *) fail 64 "BACKUP_ENCRYPT must be none, openssl or age" ;;
esac

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else openssl dgst -sha256 "$1" | sed 's/^.*= //'; fi
}

# Run a command inside the db container (stdin passes through), or against BACKUP_DIRECT_URL.
dbx() {
  if [ -n "${BACKUP_DIRECT_URL:-}" ]; then "$@"; else $COMPOSE exec -T db "$@"; fi
}
dump() {
  if [ -n "${BACKUP_DIRECT_URL:-}" ]; then pg_dump -Fc "$BACKUP_DIRECT_URL"
  else $COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'; fi
}

log INFO "dumping the database"
dump >"$PLAIN.partial" || fail 1 "pg_dump failed"
[ -s "$PLAIN.partial" ] || fail 1 "pg_dump produced an empty file"
mv "$PLAIN.partial" "$PLAIN"

# Verification 1: the archive's table of contents must be readable and contain the application tables.
if [ -n "${BACKUP_DIRECT_URL:-}" ]; then
  pg_restore --list "$PLAIN" >"$BACKUP_DIR/.toc" || fail 2 "pg_restore --list failed on $NAME"
else
  $COMPOSE exec -T db pg_restore --list <"$PLAIN" >"$BACKUP_DIR/.toc" || fail 2 "pg_restore --list failed on $NAME"
fi
grep -q 'TABLE DATA public users' "$BACKUP_DIR/.toc" || fail 2 "the dump does not contain public.users"
TABLES="$(grep -c 'TABLE DATA public ' "$BACKUP_DIR/.toc" || true)"
rm -f "$BACKUP_DIR/.toc"
log INFO "dump readable: $TABLES tables ($(du -h "$PLAIN" | cut -f1))"

# Verification 2 (optional): restore into a scratch database inside the db container and compare table lists/counts.
VERIFIED=false
if [ "${BACKUP_VERIFY_RESTORE:-0}" = "1" ] && [ -z "${BACKUP_DIRECT_URL:-}" ]; then
  log INFO "restore test into a scratch database"
  # shellcheck disable=SC2016
  $COMPOSE exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists dor_verify && createdb -U "$POSTGRES_USER" -E UTF8 dor_verify' || fail 2 "could not create the scratch database"
  # shellcheck disable=SC2016
  $COMPOSE exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d dor_verify --no-owner' <"$PLAIN" || { $COMPOSE exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists dor_verify' || true; fail 2 "restore into the scratch database failed"; }
  COUNTS_SQL="select string_agg(format('select %L as t, count(*) as n from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname='public'"
  LIVE="$($COMPOSE exec -T db sh -c 'sql=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "'"$COUNTS_SQL"'"); psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$sql order by 1"')"
  COPY="$($COMPOSE exec -T db sh -c 'sql=$(psql -U "$POSTGRES_USER" -d dor_verify -At -c "'"$COUNTS_SQL"'"); psql -U "$POSTGRES_USER" -d dor_verify -At -c "$sql order by 1"')"
  # shellcheck disable=SC2016
  $COMPOSE exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists dor_verify' || log WARN "could not drop dor_verify"
  LT="$(printf '%s\n' "$LIVE" | cut -d'|' -f1)"; CT="$(printf '%s\n' "$COPY" | cut -d'|' -f1)"
  [ "$LT" = "$CT" ] || fail 2 "restore test: the table lists differ"
  if [ "$LIVE" != "$COPY" ]; then
    # Rows can legitimately change between the dump and the comparison on a live system.
    log WARN "restore test: some row counts differ (normal if tickets were issued meanwhile):"
    printf '%s\n' "$LIVE" >"$BACKUP_DIR/.live"; printf '%s\n' "$COPY" >"$BACKUP_DIR/.copy"
    diff "$BACKUP_DIR/.live" "$BACKUP_DIR/.copy" || true
    rm -f "$BACKUP_DIR/.live" "$BACKUP_DIR/.copy"
    [ "${BACKUP_STRICT_COUNTS:-0}" != "1" ] || fail 2 "row counts differ and BACKUP_STRICT_COUNTS=1"
  fi
  VERIFIED=true
  log INFO "restore test passed"
fi

# Encryption (after verification, which needs the plain dump).
FINAL="$PLAIN"
case "$ENCRYPT" in
  openssl)
    FINAL="$PLAIN.enc"
    BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$PLAIN" -out "$FINAL" || { rm -f "$FINAL"; fail 3 "openssl encryption failed"; }
    rm -f "$PLAIN"; log INFO "encrypted with openssl (decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in FILE.enc -out FILE)" ;;
  age)
    FINAL="$PLAIN.age"
    age -r "$BACKUP_AGE_RECIPIENT" -o "$FINAL" "$PLAIN" || { rm -f "$FINAL"; fail 3 "age encryption failed"; }
    rm -f "$PLAIN"; log INFO "encrypted with age" ;;
esac
FNAME="$(basename "$FINAL")"
SUM="$(sha256 "$FINAL")"
printf '%s  %s\n' "$SUM" "$FNAME" >"$FINAL.sha256"
BYTES="$(wc -c <"$FINAL" | tr -d ' ')"

# Weekly copy on Sundays, then retention.
if [ "$(date -u +%u)" = "7" ]; then
  mkdir -p "$BACKUP_DIR/weekly"; cp "$FINAL" "$FINAL.sha256" "$BACKUP_DIR/weekly/"; log INFO "weekly copy kept"
fi
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'dor-*.dump' -o -name 'dor-*.dump.enc' -o -name 'dor-*.dump.age' -o -name 'dor-*.sha256' \) -mtime +"$KEEP_DAYS" -print -delete | while read -r f; do log INFO "retention: removed $f"; done
if [ -d "$BACKUP_DIR/weekly" ]; then
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/weekly/dor-*.dump* 2>/dev/null | grep -v '\.sha256$' | tail -n +"$((KEEP_WEEKLY + 1))" | while read -r f; do rm -f "$f" "$f.sha256"; log INFO "retention: removed $f"; done
fi

ENC=false; [ "$ENCRYPT" = "none" ] || ENC=true
printf '{\n  "ok": true,\n  "finishedAt": "%s",\n  "file": "%s",\n  "bytes": %s,\n  "sha256": "%s",\n  "format": "pg_dump-custom",\n  "encrypted": %s,\n  "tables": %s,\n  "verifiedRestore": %s,\n  "durationMs": %s\n}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FNAME" "$BYTES" "$SUM" "$ENC" "$TABLES" "$VERIFIED" "$(( ($(date +%s) - START) * 1000 ))" >"$BACKUP_DIR/last-success.json"
chmod 644 "$BACKUP_DIR/last-success.json"   # readable by the app container (shown in Admin -> Overview); holds no secrets
rm -f "$BACKUP_DIR/last-failure.json"
log INFO "backup written: $FINAL ($(du -h "$FINAL" | cut -f1))"

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  log INFO "running the upload hook"
  if BACKUP_FILE="$FINAL" BACKUP_CHECKSUM_FILE="$FINAL.sha256" sh -c "$BACKUP_UPLOAD_CMD"; then log INFO "upload finished"
  else fail 4 "upload hook failed (the local backup $FNAME is fine)"; fi
fi
