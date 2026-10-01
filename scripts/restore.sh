#!/bin/sh
# Restore a backup made by scripts/backup.sh into the Docker Compose installation. DESTROYS the current data.
#
#   scripts/restore.sh backups/dor-XXXX.dump[.enc|.age] [--yes]
#
# Steps: verify the sha256 file, decrypt if needed (BACKUP_PASSPHRASE for .enc; AGE_IDENTITY=key-file for .age),
# `pg_restore --list` check, stop the app, restore with --clean, start the app (it applies newer migrations itself).
# Restore a backup into the same app version that made it, or an older one's data into a newer app (migrations run
# on start). Never restore into an OLDER app version. COMPOSE as in backup.sh. Exit: 0 ok, 1 failed, 2 verification failed.
set -eu
umask 077
cd "$(dirname "$0")/.."
FILE="${1:?usage: restore.sh <file> [--yes]}"
COMPOSE="${COMPOSE:-docker compose}"
log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"; }
die() { code="$1"; shift; log ERROR "$*" >&2; exit "$code"; }

[ -f "$FILE" ] || die 1 "no such file: $FILE"

if [ -f "$FILE.sha256" ]; then
  expected="$(cut -d' ' -f1 "$FILE.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$FILE" | cut -d' ' -f1)"; else actual="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"; fi
  [ "$expected" = "$actual" ] || die 2 "checksum mismatch: the file is damaged or was modified"
  log INFO "sha256 checksum matches"
else
  log WARN "no $FILE.sha256; checksum not checked"
fi

WORK="$FILE"; TMP=""
case "$FILE" in
  *.enc) [ -n "${BACKUP_PASSPHRASE:-}" ] || die 1 "encrypted backup: set BACKUP_PASSPHRASE"
         TMP="$(mktemp)"; WORK="$TMP"
         openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$TMP" || { rm -f "$TMP"; die 1 "decryption failed (wrong passphrase?)"; } ;;
  *.age) [ -n "${AGE_IDENTITY:-}" ] || die 1 "age backup: set AGE_IDENTITY to your key file"
         TMP="$(mktemp)"; WORK="$TMP"
         age -d -i "$AGE_IDENTITY" -o "$TMP" "$FILE" || { rm -f "$TMP"; die 1 "age decryption failed"; } ;;
esac
trap '[ -z "$TMP" ] || rm -f "$TMP"' EXIT

$COMPOSE exec -T db pg_restore --list <"$WORK" >/dev/null || die 2 "pg_restore --list cannot read the dump"
log INFO "dump is readable"

if [ "${2:-}" != "--yes" ]; then
  printf 'This replaces ALL current data with %s. Type "restore" to continue: ' "$FILE"
  read -r answer
  [ "$answer" = "restore" ] || die 1 "aborted"
fi

log INFO "stopping the app"
$COMPOSE stop app
# --clean --if-exists drops and re-creates each object; --single-transaction makes it all-or-nothing.
# shellcheck disable=SC2016
if $COMPOSE exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' <"$WORK"; then
  log INFO "database restored"
else
  log ERROR "restore failed; the database was left as it was (single transaction). Starting the app again." >&2
  $COMPOSE up -d app
  exit 1
fi
$COMPOSE up -d app
log INFO "restored from $FILE. The app applies any newer migrations on start; check: $COMPOSE logs -f app"
