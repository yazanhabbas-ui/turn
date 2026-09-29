#!/bin/sh
# Restore a backup made by backup.sh. DESTROYS the current data.  Usage: scripts/restore.sh backups/dor-XXXX.dump
set -eu
cd "$(dirname "$0")/.."
FILE="${1:?usage: restore.sh <file.dump>}"
printf 'This replaces ALL current data with %s. Type "restore" to continue: ' "$FILE"
read -r answer
[ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
docker compose stop app
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$FILE"
docker compose start app
echo "restored from $FILE"
