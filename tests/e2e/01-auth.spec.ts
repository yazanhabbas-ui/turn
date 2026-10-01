import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, ar, en, watchErrors } from "./support";

test.describe("sign in and out", () => {
  test("a wrong password is refused with a clear message, the right one signs in, and sign out ends the session", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    // Not signed in: protected pages send the visitor to the login page.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: ar("auth.signInTitle") })).toBeVisible();

    // Wrong password: stays on the page and says so.
    await page.getByLabel(ar("auth.email")).fill(ACCOUNTS.admin);
    await page.getByLabel(ar("auth.password")).fill("not-the-password");
    await page.getByRole("button", { name: ar("auth.signIn") }).click();
    await expect(page.getByRole("alert").filter({ hasText: ar("auth.invalidCredentials") })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // The right password: no second factor is configured for the demo accounts, so it goes straight in.
    await page.getByLabel(ar("auth.password")).fill(PASSWORD);
    await page.getByRole("button", { name: ar("auth.signIn") }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("المسؤول العام");

    // Sign out: back on the login page, and the admin area is closed again.
    await page.getByRole("button", { name: ar("common.signOut") }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test("the same page works in English (left to right)", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByLabel(en("auth.email")).fill(ACCOUNTS.reception);
    await page.getByLabel(en("auth.password")).fill(PASSWORD);
    await page.getByRole("button", { name: en("auth.signIn") }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/en/reception");
    await expect(page.getByRole("heading", { name: en("reception.title") }).first()).toBeVisible();
    await page.getByRole("button", { name: en("common.signOut") }).click();
    await expect(page).toHaveURL(/\/en\/login/);
  });
});
