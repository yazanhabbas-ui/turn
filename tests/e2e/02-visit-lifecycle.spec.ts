import { expect, test } from "@playwright/test";
import { ACCOUNTS, BASE, ar, as, cleanSlate, facts, signedIn, ticketState, watchErrors } from "./support";

test.describe("one visit, from the reception tap to the visitor's rating", () => {
  test.beforeEach(async () => {
    await cleanSlate();
  });

  test("reception issues, the agent serves, the visitor follows on the phone and rates, the admin sees the rating", async ({
    browser,
  }) => {
    const { branchId } = await facts();
    const admin = await as(ACCOUNTS.admin);
    const khalid = await as(ACCOUNTS.khalid);

    // 1. Reception: one tap on a reason without required fields issues the ticket and shows number and wait.
    const reception = await signedIn(browser, ACCOUNTS.reception);
    const errors = watchErrors(reception.page);
    await reception.page.goto("/reception");
    await reception.page
      .getByRole("button", { name: /استفسار عام/ })
      .first()
      .click();
    const banner = reception.page.getByRole("status").filter({ hasText: /[A-E]-\d{3}/ });
    await expect(banner).toBeVisible();
    const number = (await banner.innerText()).match(/[A-E]-\d{3}/)![0];

    const state = await admin.get(`/api/v1/queue/state?branchId=${branchId}`);
    const ticket = state.tickets.find((t: { displayNumber: string }) => t.displayNumber === number);
    expect(ticket.status).toBe("WAITING");

    // 2. The visitor opens the status page behind the QR code.
    const visitor = await browser.newContext({ baseURL: BASE(), locale: "ar", viewport: { width: 390, height: 800 } });
    const phone = await visitor.newPage();
    await phone.goto(`/t/${ticket.publicToken}`);
    await expect(phone.getByText(number)).toBeVisible();
    await expect(phone.getByText(ar("visitorStatus.waiting"))).toBeVisible();

    // 3. The agent signs in, goes available and calls the next visitor.
    const agent = await signedIn(browser, ACCOUNTS.khalid);
    await agent.page.goto("/agent");
    await agent.page.getByRole("radio", { name: ar("agent.statuses.AVAILABLE") }).click();
    await expect.poll(async () => (await khalid.get("/api/v1/queue/agent")).profile.status).toBe("AVAILABLE");
    await agent.page.getByRole("button", { name: ar("agent.callNext"), exact: true }).click();
    await expect.poll(async () => (await ticketState(ticket.id))?.status).toBe("CALLED");

    // The visitor's page now tells them to go to the desk.
    await phone.reload();
    await expect(phone.getByText(ar("visitorStatus.called"))).toBeVisible();
    await expect(phone.getByText(/المكتب \d/)).toBeVisible();

    // 4. Start the service.
    await agent.page.getByRole("button", { name: ar("agent.start") }).click();
    await expect.poll(async () => (await ticketState(ticket.id))?.status).toBe("SERVING");
    await phone.reload();
    await expect(phone.getByText(ar("visitorStatus.serving"))).toBeVisible();

    // 5. Complete it with an outcome.
    await agent.page.getByRole("button", { name: ar("agent.complete"), exact: true }).click();
    const dialog = agent.page.getByRole("dialog");
    await expect(dialog).toContainText(ar("agent.completeTitle", { number }));
    await dialog.getByRole("button", { name: ar("agent.outcomes.resolved") }).click();
    await dialog.getByRole("button", { name: ar("agent.complete"), exact: true }).click();
    await expect.poll(async () => (await ticketState(ticket.id))?.status).toBe("COMPLETED");

    // 6. The visitor sees the thank-you and the rating card, and rates the visit.
    await phone.reload();
    await expect(phone.getByText(ar("visitorStatus.finished"))).toBeVisible();
    await expect(phone.getByText(ar("visitorStatus.feedback.prompt"))).toBeVisible();
    await phone.getByLabel(ar("visitorStatus.feedback.scores.5")).check({ force: true });
    await phone.getByRole("button", { name: ar("visitorStatus.feedback.submit") }).click();
    await expect(phone.getByText(ar("visitorStatus.feedback.thanks"))).toBeVisible();
    // A second look shows the card as answered.
    await phone.reload();
    await expect(phone.getByRole("button", { name: ar("visitorStatus.feedback.submit") })).toHaveCount(0);

    // 7. The administrator sees the rating in the report.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const overview = await admin.get(`/api/v1/reports/overview?from=${day(-1)}&to=${day(1)}&branchId=${branchId}`);
    expect(overview.data.csat.summary.responses).toBeGreaterThanOrEqual(1);
    expect(overview.data.csat.summary.avg).toBe(5);

    const adminSession = await signedIn(browser, ACCOUNTS.admin);
    await adminSession.page.goto("/reports");
    await expect(adminSession.page.getByRole("heading", { name: ar("reports.csat.distribution") })).toBeVisible();
    await expect(adminSession.page.getByText(ar("reports.csat.empty"))).toHaveCount(0);

    expect(errors).toEqual([]);
    await Promise.all([reception.context, visitor, agent.context, adminSession.context].map((c) => c.close()));
  });
});
