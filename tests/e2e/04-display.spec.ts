import { expect, test } from "@playwright/test";
import { ACCOUNTS, ar, as, cleanSlate, facts, issueTicket, signedIn, ticketState, BASE } from "./support";

test.describe("waiting-room display screen", () => {
  test.beforeEach(async () => {
    await cleanSlate();
  });

  test("an administrator adds a screen, the TV pairs with the code, shows the called number in the chosen theme", async ({
    browser,
  }) => {
    const { branchId } = await facts();
    const screenName = `شاشة الاختبار ${Date.now() % 100000}`;

    // 1. Admin → Screens → Add: name, light theme, save. The pairing code appears.
    const admin = await signedIn(browser, ACCOUNTS.admin);
    await admin.page.goto("/admin/screens");
    await admin.page.getByRole("button", { name: ar("screens.add") }).click();
    const dialog = admin.page.getByRole("dialog");
    await dialog.getByLabel(ar("ui.name")).fill(screenName);
    await dialog.getByRole("radio", { name: ar("themePicker.light") }).check();
    await dialog.getByRole("button", { name: ar("ui.save") }).click();
    const code = admin.page.getByLabel(ar("screens.pairing.code"));
    await expect(code).toBeVisible();
    const pairingCode = (await code.innerText()).trim();
    expect(pairingCode).toMatch(/^[A-Z0-9]{4,12}$/);
    await admin.page.getByRole("button", { name: ar("common.close") }).click();
    await expect(admin.page.getByText(screenName)).toBeVisible();

    // 2. The TV opens /display, types the code and pairs.
    const tv = await browser.newContext({ baseURL: BASE(), locale: "ar", viewport: { width: 1920, height: 1080 } });
    const screen = await tv.newPage();
    await screen.goto("/display");
    await expect(screen.getByRole("heading", { name: ar("display.notPaired") })).toBeVisible();
    await screen.locator("#pair-code").fill("WRONG1");
    await screen.getByRole("button", { name: ar("display.pair"), exact: true }).click();
    await expect(screen.getByText(ar("display.invalidCode"))).toBeVisible();
    await screen.locator("#pair-code").fill(pairingCode);
    await screen.getByRole("button", { name: ar("display.pair"), exact: true }).click();
    await expect(screen.locator(".dor-display")).toBeVisible();
    await expect(screen.locator(".dor-display")).toHaveAttribute("data-theme", "light");

    // 3. A visitor is called; the number appears on the screen (pushed through the socket, no reload).
    const issued = await issueTicket("general");
    const khalid = await as(ACCOUNTS.khalid);
    await khalid.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await khalid.post("/api/v1/queue/call-next", {});
    await expect.poll(async () => (await ticketState(issued.ticket.id))?.status).toBe("CALLED");
    await expect(screen.getByText(issued.ticket.displayNumber).first()).toBeVisible();

    // 4. The same screen kept paired after a reload (the token is stored on the device).
    await screen.reload();
    await expect(screen.locator(".dor-display")).toBeVisible();
    await expect(screen.getByText(issued.ticket.displayNumber).first()).toBeVisible();

    // 5. A second screen with the dark theme, paired through the address with the code in it.
    const root = await as(ACCOUNTS.admin);
    const created = await root.post("/api/v1/admin/displays", {
      name: "شاشة الاختبار الداكنة",
      branchId,
      layout: "classic",
      config: { theme: "dark" },
    });
    const dark = await browser.newContext({ baseURL: BASE(), locale: "ar", viewport: { width: 1280, height: 720 } });
    const darkScreen = await dark.newPage();
    await darkScreen.goto(`/display?code=${created.pairingCode}`);
    await expect(darkScreen.locator(".dor-display")).toHaveAttribute("data-theme", "dark");
    await expect(darkScreen.locator(".dor-display")).toHaveClass(/\bdark\b/);

    // 6. Revoking a screen sends it back to the pairing page at once.
    await root.post(`/api/v1/admin/displays/${created.id}/revoke`, {});
    await expect(darkScreen.getByRole("heading", { name: ar("display.notPaired") })).toBeVisible();

    await Promise.all([admin.context.close(), tv.close(), dark.close()]);
  });
});
