import { expect, test } from "@playwright/test";
import { ACCOUNTS, BASE, ar, as, cleanSlate, facts, issueTicket, signedIn, ticketState, watchErrors } from "./support";

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe("halls: one agent receives a group of visitors together (D62)", () => {
  let hallId = "";

  test.beforeEach(async () => {
    await cleanSlate();
    const admin = await as(ACCOUNTS.admin);
    const { branchId, reason } = await facts();
    await admin.put("/api/v1/admin/settings/halls", {
      enabled: true,
      groupMode: "same_reason",
      minGroup: 1,
      maxGroup: 0,
      allowTopUp: true,
      autoStartWhenAllEntered: true,
      announceMode: "list",
      maxAnnounced: 6,
    });
    // "General enquiry" is delivered in a hall for this scenario.
    const list = await admin.get("/api/v1/admin/reasons");
    const general = list.items.find((r: any) => r.id === reason.general);
    await admin.put(`/api/v1/admin/reasons/${general.id}`, {
      code: general.code,
      name: general.name,
      description: general.description ?? undefined,
      icon: general.icon,
      color: general.color,
      prefix: general.prefix,
      defaultPriorityKey: general.defaultPriorityKey,
      expectedServiceMinutes: general.expectedServiceMinutes,
      slaTargetWaitMinutes: general.slaTargetWaitMinutes,
      intakeFields: [],
      allowAppointments: general.allowAppointments,
      requiresStaff: general.requiresStaff,
      delivery: "hall",
      isFeatured: general.isFeatured,
      shortcutKey: general.shortcutKey,
      sortOrder: general.sortOrder,
    });
    const created = await admin.post(`/api/v1/admin/branches/${branchId}/halls`, {
      number: String(900 + Math.floor(Math.random() * 90)),
      name: { ar: "قاعة التعريف", en: "Orientation hall" },
      capacity: 4,
      reasonIds: [],
    });
    hallId = created.id;
  });

  test.afterEach(async () => {
    const admin = await as(ACCOUNTS.admin);
    const { reason } = await facts();
    await cleanSlate();
    const list = await admin.get("/api/v1/admin/reasons");
    const general = list.items.find((r: any) => r.id === reason.general);
    await admin.put(`/api/v1/admin/reasons/${general.id}`, {
      code: general.code,
      name: general.name,
      description: general.description ?? undefined,
      icon: general.icon,
      color: general.color,
      prefix: general.prefix,
      defaultPriorityKey: general.defaultPriorityKey,
      expectedServiceMinutes: general.expectedServiceMinutes,
      slaTargetWaitMinutes: general.slaTargetWaitMinutes,
      intakeFields: general.intakeFields,
      allowAppointments: general.allowAppointments,
      requiresStaff: general.requiresStaff,
      delivery: "desk",
      isFeatured: general.isFeatured,
      shortcutKey: general.shortcutKey,
      sortOrder: general.sortOrder,
    });
    await admin.put("/api/v1/admin/settings/halls", { enabled: false });
    if (hallId) await admin.call("DELETE", `/api/v1/admin/halls/${hallId}`).catch(() => undefined);
  });

  test("three visitors are called together, enter, and the host closes the session", async ({ browser }) => {
    const khalid = await as(ACCOUNTS.khalid);
    const issued = [];
    for (let i = 0; i < 3; i++) issued.push((await issueTicket("general")).ticket);

    // Hall tickets are never reserved for a desk agent, even with an agent available at a desk.
    expect((await ticketState(issued[0].id))?.assignedAgentId).toBeNull();

    // A visitor follows the wait on the phone: waiting, with a position.
    const visitor = await browser.newContext({ baseURL: BASE(), locale: "ar", viewport: { width: 390, height: 800 } });
    const phone = await visitor.newPage();
    await phone.goto(`/t/${issued[0].publicToken}`);
    await expect(phone.getByText(issued[0].displayNumber)).toBeVisible();

    // The host signs in to the hall and sees the hall session panel.
    await khalid.post("/api/v1/queue/agent/status", { status: "AVAILABLE", hallId });
    const agent = await signedIn(browser, ACCOUNTS.khalid);
    const errors = watchErrors(agent.page);
    await agent.page.goto("/agent");
    await expect(agent.page.getByRole("region", { name: ar("agent.hall.title") })).toBeVisible();

    // One press calls the whole group (3 of the hall's 4 seats).
    await agent.page.getByRole("button", { name: ar("agent.hall.callNext") }).click();
    for (const t of issued) await expect.poll(async () => (await ticketState(t.id))?.status).toBe("CALLED");
    for (const t of issued) await expect(agent.page.getByText(t.displayNumber).first()).toBeVisible();

    // The visitor's page tells the group to go to the hall.
    await phone.reload();
    await expect(phone.getByText(ar("visitorStatus.called"))).toBeVisible();
    await expect(phone.getByText(ar("visitorStatus.calledHall"))).toBeVisible();

    // Everybody walks in: with the default setting the session starts by itself.
    await agent.page.getByRole("button", { name: ar("agent.hall.markAllEntered") }).click();
    for (const t of issued) await expect.poll(async () => (await ticketState(t.id))?.status).toBe("SERVING");
    await expect(agent.page.getByText(ar("agent.hall.sessionStatus.IN_SESSION")).first()).toBeVisible();

    // The host closes the session with one outcome for everybody.
    await agent.page.getByRole("button", { name: ar("agent.hall.closeSession") }).click();
    const dialog = agent.page.getByRole("dialog");
    await dialog.getByRole("button", { name: ar("agent.outcomes.resolved") }).click();
    await dialog.getByRole("button", { name: ar("agent.hall.closeSession") }).click();
    for (const t of issued) await expect.poll(async () => (await ticketState(t.id))?.status).toBe("COMPLETED");

    // The group is gone and the host can call the next one.
    await expect(agent.page.getByRole("button", { name: ar("agent.hall.callNext") })).toBeVisible();
    expect(errors).toEqual([]);
    await agent.context.close();
    await visitor.close();
  });
});
