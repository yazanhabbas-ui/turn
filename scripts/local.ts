/**
 * Runs the whole system on one machine without Docker or a system-wide PostgreSQL install:
 *
 *   npm run local            # bundled PostgreSQL + migrations + seed + app (dev mode, hot reload)
 *   npm run local -- --prod  # same, serving the production build (run `npm run build` first)
 *   npm run local -- --db    # only the database (e.g. for `npm test`); Ctrl+C to stop
 *
 * PostgreSQL binaries come from the `embedded-postgres` npm package; data lives in ./.local/pgdata
 * (git-ignored) and survives restarts. No admin rights needed. Production servers should use
 * Docker Compose (see README).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

const root = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const USER = "dor";
const PASSWORD = "dor";
const dataDir = path.join(root, ".local", "pgdata");

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

async function main() {
  ensureEnvFile();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
  });

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    log(`initialising PostgreSQL in ${path.relative(root, dataDir)} (first run only)`);
    await pg.initialise();
  }
  await pg.start();
  log(`PostgreSQL running on localhost:${PORT}`);
  await ensureDatabases();

  let app: ChildProcess | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping…");
    app?.kill("SIGINT");
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

  const prod = args.has("--prod");
  if (prod && !existsSync(path.join(root, ".next", "BUILD_ID")))
    throw new Error("No production build found. Run `npm run build` first.");
  log(prod ? "starting production server" : "starting development server (hot reload)");
  app = prod
    ? run("npx", ["tsx", "server.ts"], { ...env, NODE_ENV: "production" })
    : run(
        "npx",
        [
          "tsx",
          "watch",
          "--clear-screen=false",
          "--ignore",
          "./.next",
          "--ignore",
          "./node_modules",
          "--ignore",
          "./.local",
          "server.ts",
        ],
        env,
      );
  app.on("exit", () => void stop());
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
