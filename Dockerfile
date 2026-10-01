# syntax=docker/dockerfile:1
# One image: Next.js app + Socket.IO + background jobs (pg-boss) on Node 22 LTS, Debian bookworm (glibc).
# glibc matters: sharp (logo/avatar processing) and @node-rs/argon2 ship prebuilt glibc binaries for linux x64/arm64,
# installed by `npm ci` on the build platform. Do not switch the base to alpine without testing both.
ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1. dependencies (cached until package*.json change) ───────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── 2. build ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only (the build imports the env schema); real values come from the runtime environment.
ENV APP_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= \
    PHONE_HASH_KEY=build-time-placeholder-key \
    NEXT_TELEMETRY_DISABLED=1
# Output goes to ./.next (the local launcher uses .next-prod; that folder is not part of the image).
RUN npx next build && rm -rf .next/cache

# ── 3. runtime ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=:: \
    NODE_OPTIONS=--max-old-space-size=768
# tini = PID 1: forwards SIGTERM to the app and reaps zombies, so `docker stop` triggers the graceful shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
# Only what the running server needs. server.ts and src/ run through tsx at start-up (a runtime dependency),
# so the TypeScript sources, tsconfig.json (path aliases), the SQL migrations (drizzle/), the UI strings
# (messages/), public/ (fonts, icons, ~40 MB of bundled Arabic voice clips) and node_modules (incl. the PDF fonts
# read from node_modules/@fontsource) are copied. assets/ (design originals), tests, docs and voice-samples are not.
COPY --chown=node:node package.json package-lock.json tsconfig.json next.config.ts server.ts ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node public ./public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node messages ./messages
COPY --chown=node:node src ./src
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x docker/entrypoint.sh
USER node
EXPOSE 3000
# Liveness + database. /api/ready (readiness: migrations, background jobs, draining) is for external monitoring.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker/entrypoint.sh"]
