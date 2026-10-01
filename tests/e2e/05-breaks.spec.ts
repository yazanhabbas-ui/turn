import { expect, test } from "@playwright/test";
import { ACCOUNTS, ar, as, cleanSlate, signedIn } from "./support";

test.describe("limit on simultaneous breaks", () => {
  test.beforeEach(async () => {
    await cleanSlate();
    // The default allows two agents on a break at the same time.
    const admin = await as(ACCOUNTS.admin);
    const settings = await admin.get("/api/v1/admin/settings");
    await admin.put("/api/v1/admin/settings/breaks", {
      ...settings.breaks,
      enabled: true,
      maxOnBreak: { mode: "count", value: 2 },
    });
  });

  test("with two agents on break the third is queued, and is offered the place when a colleague returns", async ({ browser }) => {
    const khalid = await as(ACCOUNTS.khalid);
    const noura = await as(ACCOUNTS.noura);
    const mohammed = await as(ACCOUNTS.mohammed);
    for (const a of [khalid, noura, mohammed]) await a.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await khalid.post("/api/v1/queue/agent/status", { status: "ON_BREAK" });
    await noura.post("/api/v1/queue/agent/status", { status: "ON_BREAK" });
    const status = async (a: typeof khalid) => (await a.get("/api/v1/queue/agent")).profile.status;
    expect(await status(khalid)).toBe("ON_BREAK");
    expect(await status(noura)).toBe("ON_BREAK");

    // The third agent asks for a break on screen: told that the limit is reached and that they are in line.
    const third = await signedIn(browser, ACCOUNTS.mohammed);
    await third.page.goto("/agent");
    await third.page.getByRole("radio", { name: ar("agent.statuses.ON_BREAK") }).click();
    const picker = third.page.getByRole("dialog");
    await picker.getByRole("button", { name: /صلاة/ }).click();
    await expect(third.page.getByText(ar("agent.breakQueuedTitle"))).toBeVisible();
    expect(await status(mohammed)).toBe("AVAILABLE");
    expect((await mohammed.get("/api/v1/queue/agent")).breaks).toMatchObject({
      limit: 2,
      onBreak: 2,
      request: { status: "waiting", position: 1 },
    });

    // A colleague comes back: the place is offered to the agent in line, live on their screen.
    await khalid.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await expect(third.page.getByText(ar("agent.breakAvailableTitle"))).toBeVisible();
    await third.page.getByRole("button", { name: ar("agent.breakStart") }).click();
    await expect.poll(() => status(mohammed)).toBe("ON_BREAK");
    expect((await mohammed.get("/api/v1/queue/agent")).breaks.request).toBeNull();

    // The limit holds: two on break again, a returning agent can leave the break normally.
    await noura.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await mohammed.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await third.context.close();
  });
});
