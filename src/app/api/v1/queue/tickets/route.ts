import { issueInput, issueTicket } from "@/server/queue/tickets";
import { route } from "@/server/http/route";

/** Issue a ticket. Send an `Idempotency-Key` header (or body.idempotencyKey) so retries never create duplicates. */
export const POST = route({ permission: "tickets.issue", body: issueInput }, async ({ actor, body, req }) =>
  issueTicket(actor, { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined }),
);
