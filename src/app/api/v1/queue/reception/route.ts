import { route } from "@/server/http/route";
import { receptionContext } from "@/server/queue/views";

/** Reference data for the reception console (reasons with open/closed state, priorities, agents, settings). */
export const GET = route({ permission: "tickets.issue" }, async ({ actor, query }) =>
  receptionContext(actor, query.get("branchId")),
);
