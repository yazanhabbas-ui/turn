import { expect, test } from "@playwright/test";
import { ACCOUNTS, ar, as, facts, signedIn } from "./support";

test.describe("role isolation", () => {
  test("a city administrator sees and changes only their own city", async ({ browser }) => {
    const { aleppoBranchId, aleppoCityId, branchId } = await facts();
    const damascus = await as(ACCOUNTS.damascusAdmin);

    // The branch list on screen holds Damascus only.
    const { page, context } = await signedIn(browser, ACCOUNTS.damascusAdmin);
    await page.goto("/admin/branches");
    await expect(page.getByText("الفرع الرئيسي - دمشق").first()).toBeVisible();
    await expect(page.getByText("فرع حلب")).toHaveCount(0);

    // The other city's branch cannot be reached by guessing its address either.
    const aleppoUrls = [
      [
        "PUT",
        `/api/v1/admin/branches/${aleppoBranchId}`,
        { code: "ALP-01", cityId: aleppoCityId, name: { ar: "س", en: "x" }, timezone: "Asia/Damascus", weekend: [5, 6] },
      ],
      ["POST", `/api/v1/admin/branches/${aleppoBranchId}/desks`, { number: "9", name: { ar: "س", en: "x" } }],
      ["GET", `/api/v1/reports/overview?from=2026-10-01&to=2026-10-01&branchId=${aleppoBranchId}`, undefined],
      ["GET", `/api/v1/reports/live?branchId=${aleppoBranchId}`, undefined],
      ["GET", `/api/v1/queue/state?branchId=${aleppoBranchId}`, undefined],
    ] as const;
    for (const [method, url, body] of aleppoUrls) {
      await damascus.call(method, url, body, 403);
    }
    const users = (await damascus.get("/api/v1/admin/users")).items.map((u: { email: string }) => u.email);
    expect(users).toContain(ACCOUNTS.khalid);
    expect(users).not.toContain("faisal@dor.local");
    const reception = await damascus.get(`/api/v1/queue/reception?branchId=${aleppoBranchId}`);
    expect(reception.branch.id).toBe(branchId); // asking for the other city's branch never returns it

    // And the other way round.
    const aleppo = await as(ACCOUNTS.aleppoAdmin);
    await aleppo.call("GET", `/api/v1/queue/state?branchId=${branchId}`, undefined, 403);
    const aleppoUsers = (await aleppo.get("/api/v1/admin/users")).items.map((u: { email: string }) => u.email);
    expect(aleppoUsers).toContain("faisal@dor.local");
    expect(aleppoUsers).not.toContain(ACCOUNTS.khalid);
    await context.close();
  });

  test("an agent gets the forbidden screen in the admin area, and the admin APIs refuse them", async ({ browser }) => {
    const { page, context } = await signedIn(browser, ACCOUNTS.khalid);
    for (const path of ["/admin", "/admin/users", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: ar("common.forbidden") })).toBeVisible();
      await expect(page.getByText(ar("common.forbiddenBody"))).toBeVisible();
      // No admin navigation is rendered for them.
      await expect(page.getByRole("link", { name: ar("admin.users"), exact: true })).toHaveCount(0);
    }
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: ar("common.forbidden") })).toBeVisible();

    const khalid = await as(ACCOUNTS.khalid);
    await khalid.call("GET", "/api/v1/admin/users", undefined, 403);
    await khalid.call("GET", "/api/v1/admin/settings", undefined, 403);
    await khalid.call(
      "POST",
      "/api/v1/queue/tickets",
      {
        branchId: (await facts()).branchId,
        reasonId: (await facts()).reason.general,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      },
      403,
    );

    // Their own workspace still works.
    await page.goto("/agent");
    await expect(page.getByRole("button", { name: ar("agent.callNext"), exact: true })).toBeVisible();
    await context.close();
  });

  test("reception cannot use the agent workspace or the admin area", async ({ browser }) => {
    const { page, context } = await signedIn(browser, ACCOUNTS.reception);
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: ar("common.forbidden") })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: ar("common.forbidden") })).toBeVisible();
    await page.goto("/reception");
    await expect(page.getByRole("heading", { name: ar("reception.chooseReason") })).toBeVisible();
    await context.close();
  });
});
