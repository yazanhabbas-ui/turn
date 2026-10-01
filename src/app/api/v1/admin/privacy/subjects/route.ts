import { route } from "@/server/http/route";
import { findSubjects } from "@/server/privacy/subjects";

/** Find visitors by phone, name or ticket number (`?q=`). */
export const GET = route({ permission: "visitors.privacy" }, async ({ actor, query }) => ({
  items: await findSubjects(actor, query.get("q") ?? ""),
}));
