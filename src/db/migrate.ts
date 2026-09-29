import "dotenv/config";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "@/server/logger";
import { db, pool } from "./client";

/**
 * Arabic text requires a UTF-8 database. Clusters initialised on Windows default to WIN1252,
 * which silently breaks every Arabic insert, so refuse to run instead.
 */
async function assertUtf8() {
  const res = await db().execute<{ enc: string }>(
    sql`select pg_encoding_to_char(encoding) as enc from pg_database where datname = current_database()`,
  );
  const enc = res.rows[0]?.enc;
  if (enc !== "UTF8") {
    throw new Error(
      `Database encoding is ${enc}; UTF8 is required. Recreate it with: CREATE DATABASE <name> ENCODING 'UTF8' TEMPLATE template0;`,
    );
  }
}

/** Applies pending SQL migrations from /drizzle. Safe to run on every start. */
export async function runMigrations() {
  await assertUtf8();
  await migrate(db(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/db/migrate.ts")) {
  runMigrations()
    .then(() => logger.info("migrations applied"))
    .catch((err) => {
      logger.fatal({ err }, "migration failed");
      process.exitCode = 1;
    })
    .finally(() => pool().end());
}
