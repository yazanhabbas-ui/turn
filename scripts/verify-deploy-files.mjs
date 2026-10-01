#!/usr/bin/env node
/**
 * Static checks of the deployment files (no Docker needed): `npm run verify:deploy`.
 * Catches the mistakes that would otherwise only show up on the server: a COPY of a missing path, a compose
 * variable that is not documented, a secret with a default in the production file, a health check that points
 * at a route that does not exist, the migrations folder missing from the image.
 * It does NOT prove that `docker build` / `docker compose up` work; CI's `docker` job does that.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const has = (p) => existsSync(path.join(root, p));

const errors = [];
const ok = [];
const check = (cond, pass, fail) => (cond ? ok.push(pass) : errors.push(fail));

function loadYaml(file) {
  if (!has(file)) {
    errors.push(`${file}: missing`);
    return null;
  }
  try {
    return yaml.load(read(file));
  } catch (e) {
    errors.push(`${file}: YAML syntax error: ${e.message.split("\n")[0]}`);
    return null;
  }
}

// ── YAML files parse ─────────────────────────────────────────────────────────
const base = loadYaml("docker-compose.yml");
const override = loadYaml("docker-compose.override.yml");
const prod = loadYaml("docker-compose.prod.yml");
const ci = loadYaml(".github/workflows/ci.yml");
const dependabot = loadYaml(".github/dependabot.yml");
if (base && override && prod && ci && dependabot) ok.push("compose, workflow and dependabot YAML parse");

// ── compose structure ────────────────────────────────────────────────────────
if (base) {
  const s = base.services ?? {};
  check(s.db && s.app, "compose: services db and app exist", "compose: services db and app are required");
  check(s.db?.healthcheck, "compose: db has a healthcheck", "compose: db needs a healthcheck (app depends_on it)");
  check(
    !s.db?.ports,
    "compose: base file does not publish the database",
    "compose: docker-compose.yml must not publish db ports (use the override file)",
  );
  check(
    s.app?.depends_on?.db?.condition === "service_healthy",
    "compose: app waits for a healthy db",
    "compose: app must depend_on db with condition service_healthy",
  );
  for (const name of ["db", "app"])
    check(s[name]?.restart, `compose: ${name} has a restart policy`, `compose: ${name} needs a restart policy`);
  check(
    base.volumes && "pgdata" in base.volumes && s.db?.volumes?.some((v) => String(v).startsWith("pgdata:")),
    "compose: database data is on the named volume pgdata",
    "compose: db must store data on the named volume pgdata",
  );
  check(
    s.app?.logging?.options?.["max-size"],
    "compose: app logs are rotated",
    "compose: app needs log rotation (logging.options.max-size)",
  );
  check(
    s.app?.build === "." || s.app?.build?.context === ".",
    "compose: app builds from the repository root",
    "compose: app.build must be '.'",
  );
}
if (override) {
  check(
    override.services?.db?.ports?.every((p) => String(p).startsWith("127.0.0.1:")),
    "compose: override publishes the database on 127.0.0.1 only",
    "compose: override must bind the db port to 127.0.0.1",
  );
}

// ── production file: required secrets, no defaults ──────────────────────────
const prodText = has("docker-compose.prod.yml") ? read("docker-compose.prod.yml") : "";
if (prod) {
  const env = prod.services?.app?.environment ?? {};
  for (const v of ["APP_ENCRYPTION_KEY", "PHONE_HASH_KEY", "APP_URL", "DATABASE_URL"]) {
    const val = String(env[v] ?? "");
    check(
      val.includes(`\${`) && val.includes(":?"),
      `prod: ${v} is required (\${...:?})`,
      `prod: ${v} must be a required variable (\${${v}:?message})`,
    );
  }
  check(
    String(prod.services?.db?.environment?.POSTGRES_PASSWORD ?? "").includes(":?"),
    "prod: POSTGRES_PASSWORD is required",
    "prod: db POSTGRES_PASSWORD must be required (:?)",
  );
  check(String(env.SEED_DEMO) === "false", "prod: demo data is switched off", 'prod: app SEED_DEMO must be "false"');
  const secretDefault = prodText
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .filter((l) => [...l.matchAll(/\$\{([A-Z_]+):-/g)].some((m) => /KEY|PASSWORD|SECRET|TOKEN/.test(m[1])));
  check(
    secretDefault.length === 0,
    "prod: no secret has a default value",
    `prod: secret with a default value: ${secretDefault.join(" | ").trim()}`,
  );
  check(
    prod.services?.app?.deploy?.resources?.limits?.memory,
    "prod: resource limits are set",
    "prod: set deploy.resources.limits for app",
  );
}

// ── Dockerfile ───────────────────────────────────────────────────────────────
const dockerfile = has("Dockerfile") ? read("Dockerfile") : "";
check(dockerfile.length > 0, "Dockerfile exists", "Dockerfile is missing");
const dockerignore = has(".dockerignore")
  ? read(".dockerignore")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  : [];
const ignored = (rel) => {
  const top = rel.replace(/^\.\//, "").split("/")[0];
  let excluded = false;
  for (const rule of dockerignore) {
    const neg = rule.startsWith("!");
    const pat = (neg ? rule.slice(1) : rule).replace(/\/$/, "");
    const re = new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    if (re.test(top) || re.test(rel.replace(/^\.\//, ""))) excluded = !neg;
  }
  return excluded;
};
// Logical lines (continuations joined).
const lines = dockerfile
  .replace(/\\\r?\n/g, " ")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const stages = new Set();
for (const l of lines) {
  const m = l.match(/^FROM\s+\S+\s+AS\s+(\S+)/i);
  if (m) stages.add(m[1]);
}
let copyCount = 0;
for (const l of lines) {
  if (!/^COPY\s/i.test(l)) continue;
  const parts = l.split(/\s+/).slice(1);
  const flags = parts.filter((p) => p.startsWith("--"));
  const args = parts.filter((p) => !p.startsWith("--"));
  const from = flags.find((f) => f.startsWith("--from="))?.slice(7);
  if (from) {
    check(
      stages.has(from),
      `Dockerfile: COPY --from=${from} refers to a defined stage`,
      `Dockerfile: COPY --from=${from}: no such stage`,
    );
    continue;
  }
  const srcs = args.slice(0, -1);
  for (const src of srcs) {
    copyCount++;
    if (src === ".") continue;
    check(has(src), `Dockerfile: COPY source ${src} exists`, `Dockerfile: COPY source "${src}" does not exist`);
    check(
      !ignored(src),
      `Dockerfile: ${src} is not excluded by .dockerignore`,
      `Dockerfile: COPY source "${src}" is excluded by .dockerignore (the build would fail)`,
    );
  }
}
check(copyCount > 0, "Dockerfile: has COPY instructions", "Dockerfile: no COPY instructions found");
check(
  /^USER\s+(?!root)\S+/im.test(dockerfile),
  "Dockerfile: runs as a non-root user",
  "Dockerfile: must switch to a non-root USER",
);
check(/^HEALTHCHECK/im.test(dockerfile), "Dockerfile: has a HEALTHCHECK", "Dockerfile: HEALTHCHECK is missing");
check(
  /tini/.test(dockerfile) && /^ENTRYPOINT.*tini/im.test(dockerfile),
  "Dockerfile: tini is PID 1",
  "Dockerfile: use tini as ENTRYPOINT (signal forwarding)",
);
check(/NODE_ENV=production/.test(dockerfile), "Dockerfile: NODE_ENV=production", "Dockerfile: NODE_ENV=production is missing");
check(
  /COPY\s+(--\S+\s+)*drizzle\s/m.test(dockerfile),
  "Dockerfile: the migrations folder (drizzle/) is copied into the image",
  "Dockerfile: drizzle/ (migrations) is not copied into the runtime image",
);
const healthPath = lines.find((l) => l.startsWith("HEALTHCHECK") || l.startsWith("CMD node -e"))?.match(/\/api\/[a-z/]+/)?.[0];
const healthLine = lines.find((l) => /fetch\(/.test(l));
const healthPathResolved = healthLine?.match(/\/api\/[a-z/]+/)?.[0] ?? healthPath;
check(
  healthPathResolved && has(`src/app${healthPathResolved}/route.ts`),
  `healthcheck path ${healthPathResolved} is a route`,
  `healthcheck path ${healthPathResolved} has no route file under src/app`,
);
check(has("src/app/api/ready/route.ts"), "readiness route /api/ready exists", "src/app/api/ready/route.ts is missing");

// ── migrations ───────────────────────────────────────────────────────────────
if (has("drizzle/meta/_journal.json")) {
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  const sqlFiles = readdirSync(path.join(root, "drizzle")).filter((f) => f.endsWith(".sql"));
  const missing = journal.entries.filter((e) => !sqlFiles.includes(`${e.tag}.sql`)).map((e) => e.tag);
  check(
    missing.length === 0,
    `migrations: ${journal.entries.length} journal entries all have a .sql file`,
    `migrations: journal entries without a file: ${missing.join(", ")}`,
  );
} else errors.push("drizzle/meta/_journal.json is missing");

// ── entrypoint ───────────────────────────────────────────────────────────────
const entry = has("docker/entrypoint.sh") ? read("docker/entrypoint.sh") : "";
check(entry.includes("src/db/migrate.ts"), "entrypoint: runs the migrations", "entrypoint: must run src/db/migrate.ts");
check(
  entry.includes("bootstrap-admin.ts") && has("src/db/bootstrap-admin.ts"),
  "entrypoint: first-admin bootstrap exists",
  "entrypoint: bootstrap-admin missing",
);
check(/exec\s+node/.test(entry), "entrypoint: execs node (signals reach the server)", "entrypoint: must `exec` the server");
for (const f of ["docker/entrypoint.sh", "scripts/backup.sh", "scripts/restore.sh"]) {
  check(!read(f).includes("\r"), `${f}: LF line endings`, `${f}: has CRLF line endings (breaks in Linux containers)`);
}

// ── .dockerignore must keep secrets and bulk out ─────────────────────────────
for (const must of [".env", "node_modules", ".next", "assets", "voice-samples", "backups", ".local"]) {
  check(
    dockerignore.some((r) => r === must || r === `${must}/` || r === `${must}*` || r === `${must}.*`),
    `.dockerignore excludes ${must}`,
    `.dockerignore must exclude ${must}`,
  );
}

// ── environment variables are documented ────────────────────────────────────
const example = has(".env.example") ? read(".env.example") : "";
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const exempt = new Set([
  "NODE_ENV",
  "HOSTNAME",
  "COMPOSE_FILE",
  "COMPOSE",
  "SEED_ORG_SLUG",
  "DEV_BUNDLER",
  "NEXT_DIST_DIR",
  "DOR_FAST_BUILD",
  "APP_VERSION",
]);
const composeVars = new Set();
for (const file of ["docker-compose.yml", "docker-compose.override.yml", "docker-compose.prod.yml"]) {
  if (!has(file)) continue;
  for (const m of read(file).matchAll(/\$\{([A-Z][A-Z0-9_]*)[:?}-]/g)) composeVars.add(m[1]);
}
const undocumentedCompose = [...composeVars].filter((v) => !documented.has(v) && !exempt.has(v));
check(
  undocumentedCompose.length === 0,
  `compose variables (${composeVars.size}) are all in .env.example`,
  `compose variables missing from .env.example: ${undocumentedCompose.join(", ")}`,
);
const schemaVars = [...read("src/server/env.ts").matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
const undocumentedSchema = schemaVars.filter((v) => !documented.has(v) && !exempt.has(v));
check(
  undocumentedSchema.length === 0,
  `environment schema variables (${schemaVars.length}) are all in .env.example`,
  `src/server/env.ts variables missing from .env.example: ${undocumentedSchema.join(", ")}`,
);

// ── native modules for linux/glibc are in the lockfile ──────────────────────
const lock = has("package-lock.json") ? read("package-lock.json") : "";
for (const pkg of [
  "@img/sharp-linux-x64",
  "@img/sharp-linux-arm64",
  "@node-rs/argon2-linux-x64-gnu",
  "@node-rs/argon2-linux-arm64-gnu",
]) {
  check(
    lock.includes(`"node_modules/${pkg}"`),
    `lockfile has ${pkg}`,
    `package-lock.json has no ${pkg}: the image build on that platform would lack the native binary`,
  );
}

// ── CI workflow ──────────────────────────────────────────────────────────────
if (ci) {
  check(
    ci.permissions?.contents === "read",
    "ci: top-level permissions are read-only",
    "ci: set top-level `permissions: contents: read`",
  );
  check(
    ci.concurrency?.["cancel-in-progress"] !== undefined,
    "ci: concurrency is configured",
    "ci: add a concurrency group with cancel-in-progress",
  );
  for (const [name, job] of Object.entries(ci.jobs ?? {}))
    check(job["timeout-minutes"], `ci: job ${name} has a timeout`, `ci: job ${name} needs timeout-minutes`);
}

for (const m of ok) console.log(`  ok   ${m}`);
for (const m of errors) console.error(`  FAIL ${m}`);
console.log(`\n${ok.length} checks passed, ${errors.length} failed`);
process.exit(errors.length ? 1 : 0);
