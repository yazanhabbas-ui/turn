#!/usr/bin/env node
/**
 * Backup / restore tool that needs only Node.js and the `pg` driver: no pg_dump, no Docker.
 * It is what backup.ps1 / restore.ps1 run for the bundled PostgreSQL of `npm run local` (which ships no pg_dump),
 * and it works against any PostgreSQL the DATABASE_URL points at.
 *
 *   node scripts/db-backup.mjs backup  [--verify-restore]
 *   node scripts/db-backup.mjs verify  <file>
 *   node scripts/db-backup.mjs restore <file> [--target-url <url>] [--migrate] [--allow-newer-schema] [--yes]
 *   (--allow-newer-schema: drills only; loads older data into a newer schema, rows missing new columns get defaults)
 *
 * Format ("dor-logical-1"): gzip-compressed NDJSON. One header line, then one line per row of every table of the
 * `public` schema, then an end line with the row count (a truncated file is detected). Taken inside ONE
 * read-only REPEATABLE READ transaction, so it is a consistent snapshot and never modifies the source database.
 * Logos and avatars live in the database (bytea), so this file is the complete backup. Restore needs the target
 * to be migrated to the same schema version (use --migrate on an empty database).
 *
 * Environment: DATABASE_URL (or .env), BACKUP_DIR (./backups), BACKUP_KEEP_DAYS (14), BACKUP_KEEP_WEEKLY (8),
 * BACKUP_PASSPHRASE (encrypts with AES-256-GCM + scrypt; required again to restore), BACKUP_UPLOAD_CMD (shell
 * command run after success with BACKUP_FILE and BACKUP_CHECKSUM_FILE set), BACKUP_VERIFY_RESTORE=1.
 * Exit codes: 0 ok, 1 backup failed, 2 verification failed, 3 upload failed (the local backup is fine), 64 usage.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { PassThrough, Transform } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const ROOT = path.resolve(import.meta.dirname, "..");
const FORMAT = "dor-logical-1";
const MAGIC = Buffer.from("DORENC1\n");
const BACKUP_DIR = path.resolve(ROOT, process.env.BACKUP_DIR ?? "backups");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY ?? 8);
const PASSPHRASE = process.env.BACKUP_PASSPHRASE || "";

const log = (level, msg) => (level === "ERROR" ? console.error : console.log)(`${new Date().toISOString()} ${level} ${msg}`);
const info = (m) => log("INFO", m);
class Failure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const q = (ident) => `"${ident.replace(/"/g, '""')}"`;
const dbLabel = (url) => {
  const u = new URL(url);
  return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Failure("DATABASE_URL is not set (and there is no .env)", 64);
  return url;
}

// ───────────────────────────── writing / reading the file ─────────────────────────────

/** Tap that hashes and counts the bytes that flow through (the final file content). */
function tap() {
  const hash = createHash("sha256");
  let bytes = 0;
  const t = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  return { stream: t, result: () => ({ sha256: hash.digest("hex"), bytes }) };
}

function encryptStream() {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(PASSPHRASE, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      const out = cipher.update(chunk);
      if (!started) {
        started = true;
        return cb(null, Buffer.concat([MAGIC, salt, iv, out]));
      }
      cb(null, out);
    },
    flush(cb) {
      const rest = cipher.final();
      const head = started ? Buffer.alloc(0) : Buffer.concat([MAGIC, salt, iv]);
      cb(null, Buffer.concat([head, rest, cipher.getAuthTag()]));
    },
  });
}

/** Readable stream of the decrypted bytes of an encrypted backup. */
function decryptedStream(file) {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  const head = Buffer.alloc(MAGIC.length + 28);
  readSync(fd, head, 0, head.length, 0);
  const tag = Buffer.alloc(16);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Failure("not an encrypted Dor backup", 2);
  if (!PASSPHRASE) throw new Failure("this backup is encrypted: set BACKUP_PASSPHRASE", 2);
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(PASSPHRASE, salt, 32), iv);
  decipher.setAuthTag(tag);
  const body = createReadStream(file, { start: head.length, end: size - 17 });
  const out = new PassThrough();
  // GCM authenticates only at the end: a wrong passphrase or a corrupt file surfaces as an error on the stream.
  pipeline(body, decipher, out).catch((e) =>
    out.destroy(new Failure(`decryption failed (wrong passphrase or corrupt file): ${e.message}`, 2)),
  );
  return out;
}

function isEncrypted(file) {
  const fd = openSync(file, "r");
  const b = Buffer.alloc(MAGIC.length);
  readSync(fd, b, 0, b.length, 0);
  closeSync(fd);
  return b.equals(MAGIC);
}

/** Async iterator over the parsed lines of a backup file. */
async function* readLines(file) {
  const source = isEncrypted(file) ? decryptedStream(file) : createReadStream(file);
  const gunzip = createGunzip();
  source.on("error", (e) => gunzip.destroy(e));
  source.pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  try {
    for await (const line of rl) if (line) yield JSON.parse(line);
  } catch (e) {
    if (e instanceof Failure) throw e;
    throw new Failure(`${e.message} (${isEncrypted(file) ? "wrong passphrase or damaged file" : "damaged file"})`, 2);
  }
}

// ───────────────────────────── backup ─────────────────────────────

async function dumpTo(client, writeLine) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tables = (await client.query("select tablename from pg_tables where schemaname = 'public' order by tablename")).rows.map(
    (r) => r.tablename,
  );
  const seqs = (
    await client.query(
      "select sequencename, last_value::text as v from pg_sequences where schemaname = 'public' and last_value is not null",
    )
  ).rows;
  let migrations = 0;
  try {
    migrations = (await client.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
  } catch {
    /* not migrated */
  }
  const version = (await client.query("show server_version")).rows[0].server_version;
  const counts = {};
  for (const t of tables) counts[t] = Number((await client.query(`select count(*) as n from public.${q(t)}`)).rows[0].n);
  writeLine({
    dor: "backup",
    format: FORMAT,
    createdAt: new Date().toISOString(),
    server: version,
    migrations,
    tables: counts,
    sequences: Object.fromEntries(seqs.map((s) => [s.sequencename, s.v])),
  });
  let total = 0;
  for (const t of tables) {
    await client.query(`DECLARE c NO SCROLL CURSOR FOR select row_to_json(x)::text as j from public.${q(t)} x`);
    for (;;) {
      const { rows } = await client.query("FETCH 2000 FROM c");
      if (!rows.length) break;
      for (const r of rows) writeLine(`{"t":${JSON.stringify(t)},"r":${r.j}}`);
      total += rows.length;
    }
    await client.query("CLOSE c");
  }
  writeLine({ end: true, rows: total });
  await client.query("ROLLBACK");
  return { tables: counts, rows: total };
}

async function writeBackup(url, target) {
  const client = new Client({ connectionString: url });
  await client.connect();
  const gzip = createGzip({ level: 6 });
  const t = tap();
  const out = createWriteStream(target, { mode: 0o600 });
  const done = pipeline(gzip, ...(PASSPHRASE ? [encryptStream()] : []), t.stream, out);
  let stats;
  try {
    const write = (line) => gzip.write((typeof line === "string" ? line : JSON.stringify(line)) + "\n");
    stats = await dumpTo(client, write);
    gzip.end();
    await done;
  } catch (e) {
    gzip.destroy();
    await done.catch(() => undefined);
    throw e;
  } finally {
    await client.end().catch(() => undefined);
  }
  return { ...stats, ...t.result() };
}

async function countFile(file) {
  let header,
    end,
    rows = 0;
  const seen = {};
  for await (const l of readLines(file)) {
    if (l.dor === "backup") header = l;
    else if (l.end) end = l;
    else if (l.t) {
      rows++;
      seen[l.t] = (seen[l.t] ?? 0) + 1;
    }
  }
  if (!header) throw new Failure("no header line", 2);
  if (!end) throw new Failure("file is truncated (no end marker)", 2);
  if (end.rows !== rows) throw new Failure(`row count mismatch (${rows} read, ${end.rows} expected)`, 2);
  for (const [t, n] of Object.entries(header.tables)) {
    if ((seen[t] ?? 0) !== n) throw new Failure(`table ${t}: ${seen[t] ?? 0} rows in file, ${n} expected`, 2);
  }
  return { header, rows };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

async function checkChecksum(file) {
  const sumFile = `${file}.sha256`;
  if (!existsSync(sumFile)) {
    info(`no ${path.basename(sumFile)} next to the file; checksum not checked`);
    return;
  }
  const expected = readFileSync(sumFile, "utf8").trim().split(/\s+/)[0];
  const actual = await sha256File(file);
  if (expected !== actual) throw new Failure(`checksum mismatch for ${path.basename(file)}`, 2);
  info("sha256 checksum matches");
}

// ───────────────────────────── restore ─────────────────────────────

async function migrationCount(client) {
  try {
    return (await client.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
  } catch {
    return 0;
  }
}

function runMigrations(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Failure(`migrations failed (exit ${c})`, 1))));
  });
}

async function firstLine(file) {
  for await (const l of readLines(file)) return l;
  throw new Failure("empty backup file", 2);
}

async function restoreInto(url, file, { migrate, allowNewer = false }) {
  const header = await firstLine(file);
  if (header.dor !== "backup" || header.format !== FORMAT) throw new Failure(`unsupported backup format ${header.format}`, 1);
  const probe = new Client({ connectionString: url });
  await probe.connect();
  let have = await migrationCount(probe);
  await probe.end();
  if (have < header.migrations && migrate) {
    info("applying migrations to the target");
    await runMigrations(url);
    const again = new Client({ connectionString: url });
    await again.connect();
    have = await migrationCount(again);
    await again.end();
  }
  if (allowNewer && have > header.migrations)
    log(
      "WARN",
      `scratch schema has ${have} migrations, the backup ${header.migrations}: restoring older data into a newer schema`,
    );
  else if (have !== header.migrations)
    throw new Failure(
      `schema version differs: target has ${have} migrations, backup has ${header.migrations}. Run the app version that made the backup, or use --migrate on an empty target.`,
      1,
    );

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const targetTables = new Set(
      (await client.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename),
    );
    const missing = Object.keys(header.tables).filter((t) => !targetTables.has(t));
    if (missing.length) throw new Failure(`target lacks tables: ${missing.join(", ")}`, 1);
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role = replica");
    } catch {
      throw new Failure("restore needs a superuser (it disables foreign-key triggers while loading)", 1);
    }
    await client.query(`TRUNCATE ${[...targetTables].map((t) => `public.${q(t)}`).join(", ")} RESTART IDENTITY CASCADE`);

    const batch = new Map();
    let restored = 0;
    const flush = async (t) => {
      const rows = batch.get(t);
      if (!rows?.length) return;
      batch.set(t, []);
      await client.query(`insert into public.${q(t)} select * from json_populate_recordset(null::public.${q(t)}, $1::json)`, [
        JSON.stringify(rows),
      ]);
    };
    for await (const l of readLines(file)) {
      if (l.t) {
        const rows = batch.get(l.t) ?? [];
        rows.push(l.r);
        batch.set(l.t, rows);
        restored++;
        if (rows.length >= 1000) await flush(l.t);
      } else if (l.end) {
        for (const t of [...batch.keys()]) await flush(t);
        if (l.rows !== restored) throw new Failure(`row count mismatch (${restored} loaded, ${l.rows} expected)`, 1);
        for (const [name, v] of Object.entries(header.sequences ?? {})) {
          await client.query("select setval($1::regclass, $2::bigint)", [`public.${q(name)}`, v]);
        }
        await client.query("COMMIT");
        return { rows: restored, tables: header.tables };
      }
    }
    throw new Failure("file ended before the end marker", 1);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function liveCounts(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  const out = {};
  for (const r of (await c.query("select tablename from pg_tables where schemaname = 'public'")).rows)
    out[r.tablename] = Number((await c.query(`select count(*) as n from public.${q(r.tablename)}`)).rows[0].n);
  await c.end();
  return out;
}

/** Creates a scratch database next to the source, restores into it, compares row counts, drops it. */
async function verifyByRestore(sourceUrl, file, expectedCounts) {
  const u = new URL(sourceUrl);
  const scratch = `${u.pathname.slice(1)}_restore_verify`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const target = new URL(sourceUrl);
  target.pathname = `/${scratch}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${q(scratch)}`);
  await admin.query(`create database ${q(scratch)} encoding 'UTF8' template template0`);
  try {
    info(`restore test into scratch database ${scratch}`);
    const r = await restoreInto(target.toString(), file, { migrate: true, allowNewer: true });
    const got = await liveCounts(target.toString());
    const bad = Object.entries(expectedCounts).filter(([t, n]) => got[t] !== n);
    if (bad.length)
      throw new Failure(`restore test: row counts differ for ${bad.map(([t, n]) => `${t} (${got[t]} vs ${n})`).join(", ")}`, 2);
    info(`restore test passed: ${r.rows} rows in ${Object.keys(got).length} tables match the backup header`);
  } finally {
    await admin
      .query(`drop database if exists ${q(scratch)} with (force)`)
      .catch((e) => log("WARN", `could not drop ${scratch}: ${e.message}`));
    await admin.end();
  }
}

// ───────────────────────────── commands ─────────────────────────────

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

function prune(dir, keep, label) {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => /^dor-\d{8}T\d{6}Z\.dorbak(\.enc)?$/.test(f))
    .sort();
  const doomed =
    keep.type === "days"
      ? files.filter((f) => Date.now() - statSync(path.join(dir, f)).mtimeMs > keep.n * 86400_000)
      : files.slice(0, Math.max(0, files.length - keep.n));
  for (const f of doomed) {
    rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, `${f}.sha256`), { force: true });
    info(`retention: removed ${label} ${f}`);
  }
}

async function cmdBackup(flags) {
  const started = Date.now();
  const url = databaseUrl();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `dor-${stamp()}.dorbak${PASSPHRASE ? ".enc" : ""}`;
  const finalPath = path.join(BACKUP_DIR, name);
  const tmp = `${finalPath}.partial`;
  info(`backing up ${dbLabel(url)} (read-only snapshot)${PASSPHRASE ? ", encrypted" : ""}`);
  let result;
  try {
    result = await writeBackup(url, tmp);
    renameSync(tmp, finalPath);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Failure(`backup failed: ${e.message}`, e.code ?? 1);
  }
  writeFileSync(`${finalPath}.sha256`, `${result.sha256}  ${name}\n`);
  info(
    `written ${name}: ${result.rows} rows, ${Object.keys(result.tables).length} tables, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`,
  );

  // Verification 1: read the file back, check structure and per-table counts against the header.
  try {
    await checkChecksum(finalPath);
    await countFile(finalPath);
    info("verification: file readable, structure and row counts consistent");
    if (flags.has("--verify-restore") || process.env.BACKUP_VERIFY_RESTORE === "1") {
      await verifyByRestore(url, finalPath, result.tables);
    }
  } catch (e) {
    throw new Failure(`verification failed: ${e.message}`, 2);
  }

  if (new Date().getUTCDay() === 0) {
    mkdirSync(path.join(BACKUP_DIR, "weekly"), { recursive: true });
    copyFileSync(finalPath, path.join(BACKUP_DIR, "weekly", name));
    copyFileSync(`${finalPath}.sha256`, path.join(BACKUP_DIR, "weekly", `${name}.sha256`));
    info("weekly copy kept");
  }
  prune(BACKUP_DIR, { type: "days", n: KEEP_DAYS }, "daily");
  prune(path.join(BACKUP_DIR, "weekly"), { type: "count", n: KEEP_WEEKLY }, "weekly");

  const status = {
    ok: true,
    finishedAt: new Date().toISOString(),
    file: name,
    bytes: result.bytes,
    sha256: result.sha256,
    format: FORMAT,
    encrypted: Boolean(PASSPHRASE),
    tables: Object.keys(result.tables).length,
    rows: result.rows,
    verifiedRestore: flags.has("--verify-restore") || process.env.BACKUP_VERIFY_RESTORE === "1",
    durationMs: Date.now() - started,
  };
  writeFileSync(path.join(BACKUP_DIR, "last-success.json"), JSON.stringify(status, null, 2), { mode: 0o644 });
  rmSync(path.join(BACKUP_DIR, "last-failure.json"), { force: true });

  if (process.env.BACKUP_UPLOAD_CMD) {
    info("running upload hook");
    const code = await new Promise((resolve) =>
      spawn(process.env.BACKUP_UPLOAD_CMD, {
        shell: true,
        stdio: "inherit",
        env: { ...process.env, BACKUP_FILE: finalPath, BACKUP_CHECKSUM_FILE: `${finalPath}.sha256` },
      }).on("exit", resolve),
    );
    if (code !== 0) throw new Failure(`upload hook exited with ${code} (the local backup ${name} is fine)`, 3);
    info("upload hook finished");
  }
  info("backup finished");
}

async function cmdVerify(file) {
  if (!file) throw new Failure("usage: verify <file>", 64);
  try {
    await checkChecksum(file);
    const { header, rows } = await countFile(file);
    info(
      `OK: ${rows} rows in ${Object.keys(header.tables).length} tables, taken ${header.createdAt}, schema ${header.migrations} migrations`,
    );
  } catch (e) {
    throw new Failure(`verification failed: ${e.message}`, 2);
  }
}

async function cmdRestore(file, flags, targetUrl) {
  if (!file) throw new Failure("usage: restore <file> [--target-url <url>] [--migrate] [--yes]", 64);
  const url = targetUrl ?? databaseUrl();
  await cmdVerify(file);
  if (!flags.has("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((r) =>
      rl.question(
        `This REPLACES ALL DATA in ${dbLabel(url)} with ${path.basename(file)}. Stop the app first. Type "restore" to continue: `,
        r,
      ),
    );
    rl.close();
    if (answer !== "restore") throw new Failure("aborted", 1);
  }
  const r = await restoreInto(url, file, { migrate: flags.has("--migrate"), allowNewer: flags.has("--allow-newer-schema") });
  info(`restored ${r.rows} rows into ${dbLabel(url)}. Start the app again.`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const ti = rest.indexOf("--target-url");
  const targetUrl = ti >= 0 ? rest[ti + 1] : undefined;
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(ti >= 0 && i === ti + 1));
  if (cmd === "backup") return cmdBackup(flags);
  if (cmd === "verify") return cmdVerify(positional[0]);
  if (cmd === "restore") return cmdRestore(positional[0], flags, targetUrl);
  throw new Failure(
    "usage: db-backup.mjs backup [--verify-restore] | verify <file> | restore <file> [--target-url url] [--migrate] [--allow-newer-schema] [--yes]",
    64,
  );
}

main().catch((e) => {
  log("ERROR", e.message);
  if (e instanceof Failure && e.code !== 64 && existsSync(BACKUP_DIR) && process.argv[2] === "backup") {
    try {
      writeFileSync(
        path.join(BACKUP_DIR, "last-failure.json"),
        JSON.stringify({ ok: false, at: new Date().toISOString(), error: e.message }, null, 2),
      );
    } catch {
      /* ignore */
    }
  }
  process.exit(e instanceof Failure ? e.code : 1);
});
