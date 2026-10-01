/**
 * Hermetic test harness shared by the end-to-end suite (tests/e2e) and the load tests (scripts/load):
 * creates a throw-away database, migrates and seeds it, and starts its OWN app instance next to (never instead of)
 * the development app. See docs/testing.md.
 *
 * Safety: every database name must end in _e2e or _load, and the dev ports (3000) and database (dor) are refused.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync, createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

export const root = path.resolve(__dirname, "..", "..");

/** Deterministic non-secret keys: the instances hold nothing but synthetic data. */
export const TEST_KEYS = {
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  PHONE_HASH_KEY: "e2e-phone-hash-key-0123456789",
};

export const DEMO_PASSWORD = "Dor@Demo2026";

function log(msg: string) {
  console.log(`\x1b[35m[harness]\x1b[0m ${msg}`);
}

export function assertSafeDatabase(url: string) {
  const name = new URL(url).pathname.slice(1);
  if (!/_(e2e|load)$/.test(name)) throw new Error(`Refusing to use database "${name}": the name must end in _e2e or _load`);
  return name;
}

/** Drops and re-creates the database (UTF-8), so every run starts from nothing. */
export async function recreateDatabase(url: string) {
  const name = assertSafeDatabase(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Postgres is not reachable at ${adminUrl.host} (${(err as Error).message}). ` +
        `Locally start it with "npm run local -- --db"; in CI use a Postgres service.`,
    );
  }
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [
    name,
  ]);
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}" encoding 'UTF8' template template0`);
  await admin.end();
}

export async function dropDatabase(url: string) {
  const name = assertSafeDatabase(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [
      name,
    ]);
    await admin.query(`drop database if exists "${name}"`);
  } catch {
    // best effort
  } finally {
    await admin.end().catch(() => undefined);
  }
}

function baseEnv(dbUrl: string, port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...TEST_KEYS,
    DATABASE_URL: dbUrl,
    PORT: String(port),
    HOSTNAME: "::",
    APP_URL: `http://localhost:${port}`,
    MESSAGING_MOCK: "true",
    LOG_LEVEL: "warn",
    SEED_PASSWORD: DEMO_PASSWORD,
    // The instances must never share state with a developer's real one.
    REDIS_URL: "",
    SMTP_HOST: "",
  };
}

function runToEnd(args: string[], env: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`))));
  });
}

const tsxArgs = ["--import", "tsx"];

export async function migrateAndSeed(dbUrl: string) {
  const env = baseEnv(dbUrl, 0);
  await runToEnd([...tsxArgs, "src/db/migrate.ts"], env, "migrate");
  await runToEnd([...tsxArgs, "src/db/seed/index.ts"], env, "seed");
}

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

/**
 * Which compiled build to run. E2E_DIST_DIR=<dir> uses an existing build as it is (CI builds first with `npm run build`
 * and sets E2E_DIST_DIR=.next). Otherwise a separate production build in .next-e2e is made (only when the code changed
 * since the last one), so it never clashes with the development app's .next or .next-prod.
 */
export async function ensureBuild(): Promise<string> {
  const given = process.env.E2E_DIST_DIR;
  if (given) {
    if (!existsSync(path.join(root, given, "BUILD_ID")))
      throw new Error(`E2E_DIST_DIR=${given} has no production build (run npm run build)`);
    log(`using the existing build in ${given}`);
    return given;
  }
  const dist = ".next-e2e";
  const id = path.join(root, dist, "BUILD_ID");
  if (!existsSync(id) || statSync(id).mtimeMs < newestSourceMtime()) {
    log("building the production version into .next-e2e (only when the code changed; about a minute)...");
    const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
    await runToEnd(
      [nextBin, "build"],
      { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: dist, DOR_FAST_BUILD: "1" },
      "next build",
    );
  } else {
    log("the .next-e2e build is up to date");
  }
  return dist;
}

export type AppInstance = { baseUrl: string; port: number; stop: () => Promise<void>; child: ChildProcess; pid: number };

/** Starts server.ts in production mode and waits until /api/health answers. */
export async function startApp(opts: {
  port: number;
  dbUrl: string;
  distDir: string;
  logFile?: string;
  env?: Record<string, string>;
  /** Extra modules preloaded into the app process (the load tests use one to sample event-loop lag and memory). */
  preload?: string[];
}): Promise<AppInstance> {
  if (opts.port === 3000) throw new Error("Refusing to use port 3000 (the development app)");
  const env = {
    ...baseEnv(opts.dbUrl, opts.port),
    NODE_ENV: "production",
    NEXT_DIST_DIR: opts.distDir,
    ...opts.env,
  } as NodeJS.ProcessEnv;
  const preload = (opts.preload ?? []).flatMap((m) => ["--import", pathToFileURL(m).href]);
  const child = spawn(process.execPath, [...tsxArgs, ...preload, "server.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tail: string[] = [];
  const sink = opts.logFile
    ? (mkdirSync(path.dirname(opts.logFile), { recursive: true }), createWriteStream(opts.logFile))
    : null;
  const onData = (b: Buffer) => {
    sink?.write(b);
    tail.push(...b.toString().split("\n").filter(Boolean));
    while (tail.length > 30) tail.shift();
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  let exited = false;
  child.on("exit", () => (exited = true));

  const baseUrl = `http://localhost:${opts.port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited) throw new Error(`the app exited while starting:\n${tail.join("\n")}`);
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the app did not become healthy in 120 s:\n${tail.join("\n")}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const stop = () =>
    new Promise<void>((resolve) => {
      if (exited) return resolve();
      const force = setTimeout(() => child.kill("SIGKILL"), 8000);
      child.once("exit", () => {
        clearTimeout(force);
        sink?.end();
        resolve();
      });
      child.kill("SIGTERM");
    });
  return { baseUrl, port: opts.port, stop, child, pid: child.pid! };
}
