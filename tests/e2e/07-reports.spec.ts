import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, ar, signedIn, watchErrors } from "./support";

test.describe("reports", () => {
  test("the page loads its data and charts without errors", async ({ browser }) => {
    const { page, context } = await signedIn(browser, ACCOUNTS.admin);
    const errors = watchErrors(page);
    const overview = page.waitForResponse((r) => r.url().includes("/api/v1/reports/overview") && r.request().method() === "GET");
    await page.goto("/reports");
    expect((await overview).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: ar("reports.title") })).toBeVisible();
    // Charts are SVG drawn by ECharts inside role=img containers.
    await expect(page.getByRole("heading", { name: ar("reports.csat.distribution") })).toBeVisible();
    await expect(page.locator('[role="img"] svg').first()).toBeVisible();

    // A quick range button re-queries and keeps the page healthy.
    const again = page.waitForResponse((r) => r.url().includes("/api/v1/reports/overview"));
    await page.getByRole("button", { name: ar("reports.filters.preset.last30") }).click();
    expect((await again).status()).toBe(200);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("the download dialog exports one section as CSV", async ({ browser }) => {
    const { page, context } = await signedIn(browser, ACCOUNTS.admin);
    await page.goto("/reports");
    await page.getByRole("button", { name: ar("reportSchedules.exportMenu.button"), exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: ar("reportSchedules.exportMenu.title") })).toBeVisible();

    await dialog.getByRole("button", { name: ar("reportSchedules.exportMenu.csv") }).click();
    await dialog.getByRole("button", { name: ar("reportSchedules.exportMenu.selectNone") }).click();
    await dialog.getByRole("checkbox", { name: new RegExp(`^${ar("reportExport.sections.byAgent")}`) }).check();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: ar("reportSchedules.exportMenu.download"), exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const text = fs.readFileSync((await download.path())!, "utf8");

    // The file carries the report title, the one chosen section with its column headings, and nothing else.
    expect(text).toContain(ar("reportExport.title"));
    expect(text).toContain(ar("reportExport.sections.byAgent"));
    expect(text).toContain(ar("reportExport.columns.agent"));
    expect(text).not.toContain(ar("reportExport.sections.byDay"));
    expect(text).not.toContain(ar("reportExport.sections.heatmap"));
    await context.close();
  });
});
