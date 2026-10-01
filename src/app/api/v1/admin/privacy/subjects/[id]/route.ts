import { route } from "@/server/http/route";
import { subjectDetails } from "@/server/privacy/subjects";

/** What is held about one visitor. */
export const GET = route({ permission: "visitors.privacy" }, ({ actor, params }) => subjectDetails(actor, params.id));
