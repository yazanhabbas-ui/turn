import { route } from "@/server/http/route";
import { listRequests } from "@/server/privacy/subjects";

/** Data-subject request history. */
export const GET = route({ permission: "visitors.privacy" }, async ({ actor }) => ({ items: await listRequests(actor) }));
