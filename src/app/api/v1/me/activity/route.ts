import { route } from "@/server/http/route";
import { activityQuery, myActivity } from "@/server/profile/activity";

/** The signed-in user's own recent activity. No permission beyond being signed in; other people's rows are never returned. */
export const GET = route({}, async ({ actor, query }) =>
  myActivity(
    actor,
    activityQuery.parse({
      type: query.get("type") ?? undefined,
      days: query.get("days") ? Number(query.get("days")) : undefined,
      before: query.get("before") ?? undefined,
      limit: query.get("limit") ? Number(query.get("limit")) : undefined,
    }),
  ),
);
