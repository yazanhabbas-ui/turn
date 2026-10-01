import { agentIssue, agentIssueInput } from "@/server/queue/agent-issue";
import { route } from "@/server/http/route";

/** An agent issues a walk-in ticket in their own branch (when the branch allows it). Send an `Idempotency-Key` header. */
export const POST = route({ permission: "tickets.issue_self", body: agentIssueInput }, async ({ actor, body, req }) =>
  agentIssue(actor, { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined }),
);
