import { sql } from "drizzle-orm";
import { Client } from "pg";
import { db } from "@/db/client";
import { runMigrations } from "@/db/migrate";

/** Creates the test database if needed, applies migrations, and returns false when Postgres is unreachable. */
export async function prepareTestDatabase(): Promise<boolean> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
  try {
    await admin.connect();
  } catch {
    if (process.env.CI) throw new Error(`Postgres not reachable at ${url.host}`);
    console.warn(`\n[integration] Postgres not reachable at ${url.host}; skipping. Start it with: docker compose up -d db\n`);
    return false;
  }
  const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  await admin.end();
  await runMigrations();
  return true;
}

export async function truncateAll() {
  const tables = await db().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db().execute(sql.raw(`truncate ${names} restart identity cascade`));
}
