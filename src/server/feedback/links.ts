import { appLink } from "../links";

/**
 * Absolute link that opens the feedback card of a visit, in the visitor's own language. The ticket's random public
 * token is the credential (the same one behind the QR code on the ticket), so the link needs no signing of its own.
 * Notification templates use it as `{feedbackLink}`.
 */
export function feedbackLinkFor(ticket: { publicToken: string; language: string }): string {
  return appLink(`/t/${ticket.publicToken}/feedback`, ticket.language);
}
