import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (npm run test:e2e). The global setup starts a private app instance (port E2E_PORT, default 3200)
 * on its own database (E2E_DATABASE_URL, default postgres://dor:dor@localhost:5433/dor_e2e); see docs/testing.md.
 */
const port = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One shared database and one app instance: tests run one after another, in file order.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    locale: "ar",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } }],
});
