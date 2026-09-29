/**
 * Runs the whole system on one machine without Docker or a system-wide PostgreSQL install:
 *
 *   npm run local            # bundled PostgreSQL + migrations + seed + app, production mode (fast).
 *                            # Rebuilds automatically when the code changed since the last build.
 *   npm run local -- --dev   # same, but development mode with hot reload (for working on the code)
 *   npm run local -- --db    # only the database (e.g. for `npm test`); Ctrl+C to stop
 *
 * PostgreSQL binaries come from the `embedded-postgres` npm package; data lives in ./.local/pgdata
 * (git-ignored) and survives restarts. No admin rights needed. Production servers should use
 * Docker Compose (see README).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

const root = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const USER = "dor";
const PASSWORD = "dor";
const dataDir = path.join(root, ".local", "pgdata");
/** Production build directory, separate from the dev server's .next so both can exist side by side. */
const PROD_DIST = ".next-prod";

function log(msg: string) {
  console.log(`\x1b[36m[local]\x1b[0m ${msg}`);
}

/** Creates .env from .env.example with fresh random keys, pointing at the bundled database. */
function ensureEnvFile() {
  const envPath = path.join(root, ".env");
  if (existsSync(envPath)) return;
  const example = readFileSync(path.join(root, ".env.example"), "utf8");
  const content = example
    .replace(/^APP_ENCRYPTION_KEY=.*$/m, `APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`)
    .replace(/^PHONE_HASH_KEY=.*$/m, `PHONE_HASH_KEY=${randomBytes(24).toString("hex")}`)
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://${USER}:${PASSWORD}@localhost:${PORT}/dor`)
    .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL=postgres://${USER}:${PASSWORD}@localhost:${PORT}/dor_test`)
    .replace(/^MESSAGING_MOCK=.*$/m, "MESSAGING_MOCK=true");
  writeFileSync(envPath, content);
  log("created .env with new random keys");
}

async function ensureDatabases() {
  const admin = new Client({ connectionString: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres` });
  await admin.connect();
  for (const name of ["dor", "dor_test"]) {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
    // UTF-8 is required for Arabic; template0 avoids inheriting a Windows code page.
    if (!exists.rowCount)
      await admin.query(`create database ${name} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  }
  await admin.end();
}

function run(cmd: string, argv: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(cmd, argv, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
}

function runToEnd(cmd: string, argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    run(cmd, argv, env).on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(" ")} exited with ${code}`)),
    );
  });
}

const pgLog: string[] = [];
function remember(line: string) {
  pgLog.push(line.trim());
  if (pgLog.length > 40) pgLog.shift();
}

/** Newest modification time of the files that affect the production build. */
function newestSourceMtime(): number {
  let newest = 0;
  const visit = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) visit(path.join(p, e));
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of ["src", "messages", "public", "next.config.ts", "package-lock.json", "tsconfig.json", "postcss.config.mjs"]) {
    visit(path.join(root, p));
  }
  return newest;
}

function buildIsStale(): boolean {
  const id = path.join(root, PROD_DIST, "BUILD_ID");
  return !existsSync(id) || statSync(id).mtimeMs < newestSourceMtime();
}

/**
 * Development only: webpack compiles each page on its first visit (several seconds). Visit the main pages once
 * in the background right after startup so the first real click is fast.
 */
async function warmUp() {
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: "admin@dor.local", password: process.env.SEED_PASSWORD ?? "Dor@Demo2026" }),
  }).catch(() => null);
  const cookie = login?.headers.get("set-cookie")?.split(";")[0] ?? "";
  const pages = [
    "/login",
    "/",
    "/admin",
    "/admin/users",
    "/admin/roles",
    "/admin/branches",
    "/admin/reasons",
    "/admin/groups",
    "/admin/distribution",
    "/admin/simulate",
    "/admin/settings",
    "/admin/audit",
    "/reception",
    "/agent",
    "/account",
    "/api/v1/admin/lookups",
    "/api/v1/admin/users",
    "/api/v1/admin/reasons",
    "/api/v1/admin/settings",
    "/api/v1/queue/reception",
    "/api/v1/queue/agent",
    "/api/v1/queue/state",
  ];
  const t0 = Date.now();
  for (const p of pages) await fetch(base + p, { headers: { cookie } }).catch(() => undefined);
  log(`pages pre-compiled in ${Math.round((Date.now() - t0) / 1000)} s; the app is ready`);
}

async function main() {
  ensureEnvFile();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // Keep the last lines of PostgreSQL output so a failed start explains itself.
    onLog: (m) => remember(String(m)),
    onError: (m) => remember(String(m instanceof Error ? m.message : m)),
  });

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    log(`initialising PostgreSQL in ${path.relative(root, dataDir)} (first run only)`);
    await pg.initialise();
  }
  try {
    await pg.start();
  } catch (err) {
    console.error(pgLog.join("\n"));
    throw new Error(
      `PostgreSQL did not start (${err ?? "unknown error"}). If a previous run was killed, make sure no postgres process is left running and that port ${PORT} is free.`,
    );
  }
  log(`PostgreSQL running on localhost:${PORT}`);
  await ensureDatabases();

  const state: { app?: ChildProcess } = {};
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping…");
    state.app?.kill("SIGINT");
    await pg.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const env = { ...process.env, DATABASE_URL: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/dor` };

  if (args.has("--db")) {
    log("database only; press Ctrl+C to stop");
    return;
  }

  await runToEnd("npx", ["tsx", "src/db/migrate.ts"], env);
  await runToEnd("npx", ["tsx", "src/db/seed/index.ts"], env);

  if (args.has("--dev")) {
    log("starting development server (hot reload)");
    // Next.js hot-reloads src/ itself; restarting the whole process for those files would throw away its
    // compile cache and make every page slow again. Only server.ts-level changes restart the process.
    state.app = run(
      "npx",
      [
        "tsx",
        "watch",
        "--clear-screen=false",
        "--exclude",
        "./src/**",
        "--exclude",
        "./messages/**",
        "--exclude",
        "./.next/**",
        "--exclude",
        "./.local/**",
        "server.ts",
      ],
      env,
    );
    void warmUp();
  } else {
    const prodEnv = { ...env, NODE_ENV: "production" as const, NEXT_DIST_DIR: PROD_DIST };
    if (buildIsStale()) {
      log("building the production version (only when the code changed; about a minute)…");
      await runToEnd("npx", ["next", "build"], { ...prodEnv, DOR_FAST_BUILD: "1" });
    }
    log("starting production server");
    state.app = run("npx", ["tsx", "server.ts"], prodEnv);
  }
  state.app.on("exit", () => void stop());
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
