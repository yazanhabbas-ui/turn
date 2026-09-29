#!/bin/sh
# Daily database backup. Keeps the last N days (default 14).
# Cron example (02:30 every night):  30 2 * * * /opt/dor/scripts/backup.sh >> /var/log/dor-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/dor-$STAMP.dump"
# Custom format: compressed, restorable table by table with pg_restore.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"
[ -s "$FILE" ] || { echo "backup failed: empty file" >&2; rm -f "$FILE"; exit 1; }
find "$BACKUP_DIR" -name 'dor-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"
