#!/bin/sh
set -e
echo "[dor] applying database migrations"
npx tsx src/db/migrate.ts
if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[dor] seeding (idempotent)"
  npx tsx src/db/seed/index.ts
fi
echo "[dor] starting server"
exec npx tsx server.ts
