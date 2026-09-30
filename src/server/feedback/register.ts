import { registerTemplateVars } from "../notifications/vars";
import { getSetting } from "../settings/service";
import { feedbackLinkFor } from "./links";

let registered = false;

/** Gives notification templates the `{feedbackLink}` variable, but only while feedback is on for the ticket's branch. */
export function registerFeedbackTemplateVars() {
  if (registered) return;
  registered = true;
  registerTemplateVars(async ({ ticket }) => {
    const feedback = await getSetting(ticket.organizationId, "feedback", ticket.branchId);
    return { feedbackLink: feedback.enabled ? feedbackLinkFor(ticket) : "" };
  });
}
