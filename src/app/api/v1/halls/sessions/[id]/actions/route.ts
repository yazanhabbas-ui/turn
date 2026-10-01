import { sessionAction, sessionActionInput } from "@/server/halls/service";
import { route } from "@/server/http/route";

/** enter, start, release, no_show, recall, top_up, close and cancel for a hall session; the host (or a supervisor) only. */
export const POST = route({ permission: "agent.serve", body: sessionActionInput }, async ({ actor, body, params }) =>
  sessionAction(actor, params.id, body),
);
