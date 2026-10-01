import { expect, test } from "@playwright/test";
import { ACCOUNTS, ar, as, cleanSlate, facts, issueTicket, signedIn, ticketState } from "./support";

test.describe("distribution between agents", () => {
  test.beforeEach(async () => {
    await cleanSlate();
    // Push mode: tickets are reserved for an agent as soon as one is available.
    const admin = await as(ACCOUNTS.admin);
    await admin.put("/api/v1/admin/distribution-rules", {
      scope: "global",
      config: { mode: "push", push: { strategies: ["least_waiting"] } },
    });
  });

  test.afterEach(async () => {
    const admin = await as(ACCOUNTS.admin);
    await admin.put("/api/v1/admin/distribution-rules", { scope: "global", config: { mode: "pull" } });
  });

  test("two agents, three tickets: each agent gets a different ticket, the third waits for the first free agent", async ({
    browser,
  }) => {
    const { userIds } = await facts();
    const khalidId = userIds[ACCOUNTS.khalid];
    const nouraId = userIds[ACCOUNTS.noura];
    const khalid = await as(ACCOUNTS.khalid);
    const noura = await as(ACCOUNTS.noura);
    await khalid.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });
    await noura.post("/api/v1/queue/agent/status", { status: "AVAILABLE" });

    const tickets: Awaited<ReturnType<typeof issueTicket>>["ticket"][] = [];
    for (let i = 0; i < 3; i++) tickets.push((await issueTicket("general")).ticket);

    // Two tickets are reserved, one for each agent; the third has nobody yet.
    await expect
      .poll(async () => {
        const states = await Promise.all(tickets.map((t) => ticketState(t.id)));
        return states.filter((s) => s?.assignedAgentId).length;
      })
      .toBe(2);
    const reserved = await Promise.all(tickets.map((t) => ticketState(t.id)));
    const assignees = reserved.map((s) => s?.assignedAgentId).filter(Boolean);
    expect(new Set(assignees)).toEqual(new Set([khalidId, nouraId]));

    // Each agent sees their own reserved ticket on screen and calls it.
    const pages = {
      [khalidId]: await signedIn(browser, ACCOUNTS.khalid),
      [nouraId]: await signedIn(browser, ACCOUNTS.noura),
    };
    const called: Record<string, string> = {};
    for (const id of [khalidId, nouraId]) {
      const mine = reserved.find((s) => s?.assignedAgentId === id)!;
      const { page } = pages[id];
      await page.goto("/agent");
      await expect(page.getByText(mine.displayNumber).first()).toBeVisible();
      await page.getByRole("button", { name: ar("agent.callNext"), exact: true }).click();
      await expect.poll(async () => (await ticketState(mine.id))?.status).toBe("CALLED");
      called[id] = mine.id;
    }
    expect((await ticketState(called[khalidId]))?.servingAgentId).toBe(khalidId);
    expect((await ticketState(called[nouraId]))?.servingAgentId).toBe(nouraId);
    expect(called[khalidId]).not.toBe(called[nouraId]);

    // The third ticket is still waiting, with nobody holding it.
    const third = tickets.find((t) => !Object.values(called).includes(t.id))!;
    expect((await ticketState(third.id))?.status).toBe("WAITING");

    // When one agent finishes, the waiting ticket goes to that agent (the only one free) and nobody holds two tickets.
    await khalid.post(`/api/v1/queue/tickets/${called[khalidId]}/actions`, { action: "start" });
    await khalid.post(`/api/v1/queue/tickets/${called[khalidId]}/actions`, { action: "complete", outcome: "resolved" });
    await expect.poll(async () => (await ticketState(third.id))?.assignedAgentId).toBe(khalidId);

    const finalStates = await Promise.all(tickets.map((t) => ticketState(t.id)));
    const holders = finalStates.filter((s) => s && ["CALLED", "SERVING"].includes(s.status)).map((s) => s!.servingAgentId);
    expect(new Set(holders).size).toBe(holders.length);

    for (const p of Object.values(pages)) await p.context.close();
  });
});
