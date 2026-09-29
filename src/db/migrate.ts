import "dotenv/config";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "@/server/logger";
import { db, pool } from "./client";

/** Applies pending SQL migrations from /drizzle. Safe to run on every start. */
export async function runMigrations() {
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
