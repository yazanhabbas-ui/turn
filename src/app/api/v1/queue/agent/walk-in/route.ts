import { route } from "@/server/http/route";
import { walkInContext } from "@/server/queue/views";

/** Reference data for the agent's walk-in panel: reasons of the agent's branch, priorities and the issuing settings. */
export const GET = route({ permission: "tickets.issue_self" }, async ({ actor }) => walkInContext(actor));
