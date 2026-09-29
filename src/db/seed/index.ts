/**
 * Seeds a realistic Arabic-first demo organization. Idempotent: the permission catalogue and built-in roles
 * are always synced; demo data is created only when the organization does not exist yet.
 *
 *   npm run db:seed            # create demo data if missing
 *   npm run db:seed -- --reset # wipe ALL data and re-create (development only)
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { logger } from "@/server/logger";
import { db, pool } from "../client";
import { DEMO_PASSWORD, seedOrganization } from "./demo";

const ORG_SLUG = process.env.SEED_ORG_SLUG ?? "demo";

async function wipe() {
  if (process.env.NODE_ENV === "production") throw new Error("--reset is disabled in production");
  const tables = await db().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db().execute(sql.raw(`truncate ${names} restart identity cascade`));
  logger.warn("all data wiped");
}

async function main() {
  if (process.argv.includes("--reset")) await wipe();
  const { created } = await db().transaction((tx) => seedOrganization(tx, ORG_SLUG));
  logger.info(
    { org: ORG_SLUG, created },
    created ? "demo organization created" : "organization exists; permissions and built-in roles synced",
  );
}

main()
  .then(() => {
    console.log(`\nSeed complete. Sign in at /login with admin@dor.local / ${DEMO_PASSWORD}\n`);
  })
  .catch((err) => {
    logger.fatal({ err }, "seed failed");
    process.exitCode = 1;
  })
  .finally(() => pool().end());
