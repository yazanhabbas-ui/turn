import { callGroup, callGroupInput } from "@/server/halls/service";
import { route } from "@/server/http/route";

/** The host calls the next group into the hall. Returns `{ session, created, reason, available }`. */
export const POST = route({ permission: "agent.serve", body: callGroupInput }, async ({ actor, body }) => callGroup(actor, body));
