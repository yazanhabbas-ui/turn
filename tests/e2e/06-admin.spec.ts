import { expect, test } from "@playwright/test";
import { ACCOUNTS, Api, ar, as, signedIn, tinyPng, watchErrors } from "./support";

test.describe("administration", () => {
  test("create a user in the dialog, who can then sign in", async ({ browser }) => {
    const stamp = Date.now() % 1_000_000;
    const email = `e2e.user.${stamp}@dor.local`;
    const password = "E2e-Pass-2026x";
    const { page, context } = await signedIn(browser, ACCOUNTS.admin);
    const errors = watchErrors(page);

    await page.goto("/admin/users");
    await page.getByRole("button", { name: ar("users.add") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#u-name-ar").fill(`مستخدم اختبار ${stamp}`);
    await dialog.locator("#u-name-en").fill(`E2E User ${stamp}`);
    await dialog.locator("#u-email").fill(email);
    await dialog.locator("#u-password").fill(password);
    await dialog.getByRole("button", { name: ar("ui.create") }).click();
    await expect(page.getByText(ar("users.created")).first()).toBeVisible();

    // The new person is in the list...
    await page.getByPlaceholder(ar("ui.searchPlaceholder")).fill(String(stamp));
    await expect(page.getByText(email)).toBeVisible();

    // ...and can sign in with the password that was set.
    const created = await Api.login(email, password);
    expect((await created.get("/api/v1/auth/me")).user.email).toBe(email);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("settings: search finds a section, a change shows the save bar, saving applies it", async ({ browser }) => {
    const admin = await as(ACCOUNTS.admin);
    const before = (await admin.get("/api/v1/admin/settings")).branding;
    const { page, context } = await signedIn(browser, ACCOUNTS.admin);
    const errors = watchErrors(page);

    await page.goto("/admin/settings");
    // Search: typing finds the Wi-Fi section and opens it.
    const search = page.getByRole("searchbox", { name: ar("settings.ui.search") });
    await search.fill(ar("settings.tabs.wifi"));
    await page
      .getByRole("button", { name: ar("settings.tabs.wifi") })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 2, name: ar("settings.tabs.wifi") })).toBeVisible();
    await expect(page).toHaveURL(/section=wifi/);

    // Branding: edit the English company name; the sticky bar offers Save and Discard.
    await page.getByRole("button", { name: ar("settings.tabs.branding"), exact: true }).click();
    const name = page.locator("#br-name-en");
    const newName = `E2E Services ${Date.now() % 100000}`;
    await name.fill(newName);
    const bar = page.getByRole("region", { name: ar("settings.ui.unsaved") });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: ar("ui.save") }).click();
    await expect(page.getByText(ar("settings.saved")).first()).toBeVisible();
    await expect(bar.getByText(ar("settings.ui.allSaved"))).toBeVisible();
    await expect.poll(async () => (await admin.get("/api/v1/admin/settings")).branding.companyName.en).toBe(newName);

    // Discard: a second edit is thrown away and the saved value stays.
    await name.fill("Never saved");
    await bar.getByRole("button", { name: ar("settings.ui.discard") }).click();
    await expect(name).toHaveValue(newName);

    // Restore the original name so later scenarios see the demo data.
    await admin.put("/api/v1/admin/settings/branding", before);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("branding: upload a logo, it is served; removing it brings the letter back", async ({ browser }) => {
    const admin = await as(ACCOUNTS.admin);
    const { page, context } = await signedIn(browser, ACCOUNTS.admin);
    await page.goto("/admin/settings?section=branding");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: tinyPng() });
    await expect(page.getByText(ar("logoUpload.saved")).first()).toBeVisible();
    await expect(page.getByRole("img", { name: ar("logoUpload.preview") })).toBeVisible();

    const logoUrl = (await admin.get("/api/v1/admin/settings")).branding.logoUrl as string;
    expect(logoUrl).toContain("/api/v1/public/branding/logo");
    const served = await context.request.get(logoUrl);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");

    // An unsupported file is refused with the right message (nothing changes).
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
    await expect(page.getByText(ar("logoUpload.errors.unsupported_type"))).toBeVisible();

    // Remove it again (restores the demo state).
    await page
      .getByRole("button", { name: ar("logoUpload.remove") })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: ar("logoUpload.remove") })
      .click();
    await expect.poll(async () => (await admin.get("/api/v1/admin/settings")).branding.logoUrl).toBeNull();
    await context.close();
  });

  test("the staff app switches to dark mode with the toggle and remembers it", async ({ browser }) => {
    const { page, context } = await signedIn(browser, ACCOUNTS.admin, { colorScheme: "light" });
    await page.goto("/admin");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: ar("theme.toDark") }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: ar("theme.toLight") }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await context.close();
  });
});
