#!/bin/sh
# Container start-up: wait for the database, migrate, optional first-admin bootstrap or demo seed, then run the server.
# `exec` makes node the direct child of tini, so SIGTERM reaches server.ts, which then drains and exits (server.ts).
set -e

echo "[dor] applying database migrations"
node --import tsx src/db/migrate.ts

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[dor] seeding the demo organization (idempotent)"
  node --import tsx src/db/seed/index.ts
elif [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[dor] ensuring the first super admin exists (${ADMIN_EMAIL})"
  node --import tsx src/db/bootstrap-admin.ts
fi

echo "[dor] starting server"
exec node --import tsx server.ts
