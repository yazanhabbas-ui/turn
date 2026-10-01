import path from "node:path";
import { dropDatabase, ensureBuild, migrateAndSeed, recreateDatabase, root, startApp } from "../../scripts/lib/harness";

/**
 * Starts the private app instance for the whole run and returns the teardown. Workers learn the address through
 * process.env (E2E_BASE_URL). Set E2E_KEEP=1 to keep the database for inspection, or E2E_BASE_URL to reuse an
 * instance you started yourself.
 */
export default async function globalSetup() {
  // Development shortcut: run against an instance you started yourself (never the development app on port 3000).
  if (process.env.E2E_BASE_URL) {
    if (new URL(process.env.E2E_BASE_URL).port === "3000") throw new Error("Refusing to run the e2e tests against port 3000");
    console.log(`[e2e] using the running instance ${process.env.E2E_BASE_URL}`);
    return;
  }
  const port = Number(process.env.E2E_PORT ?? 3200);
  const dbUrl = process.env.E2E_DATABASE_URL ?? "postgres://dor:dor@localhost:5433/dor_e2e";
  const t0 = Date.now();

  // Build first (it can take minutes and other work may add migrations meanwhile), then create the database.
  const distDir = await ensureBuild();
  await recreateDatabase(dbUrl);
  await migrateAndSeed(dbUrl);
  const app = await startApp({ port, dbUrl, distDir, logFile: path.join(root, "test-results", "e2e-server.log") });
  process.env.E2E_BASE_URL = app.baseUrl;
  console.log(`[e2e] app ready on ${app.baseUrl} after ${Math.round((Date.now() - t0) / 1000)} s`);

  return async () => {
    await app.stop();
    if (!process.env.E2E_KEEP) await dropDatabase(dbUrl);
  };
}
