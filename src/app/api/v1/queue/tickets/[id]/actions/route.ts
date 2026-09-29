import { actionInput, ticketAction } from "@/server/queue/tickets";
import { route } from "@/server/http/route";

/** recall · start · complete · no_show · hold · resume · cancel · transfer · assign · check_in · edit · undo */
export const POST = route({ body: actionInput }, async ({ actor, body, params }) => ticketAction(actor, params.id, body));
