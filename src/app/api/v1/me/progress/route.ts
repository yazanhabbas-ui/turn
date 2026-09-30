import { z } from "zod";
import { PERIODS } from "@/domain/profile/progress";
import { route } from "@/server/http/route";
import { myProgress } from "@/server/profile/progress";

/** The signed-in user's own progress. `period` (day, week, month; default week) sets the trend length. */
export const GET = route({}, async ({ actor, query }) =>
  myProgress(
    actor,
    z
      .enum(PERIODS)
      .default("week")
      .parse(query.get("period") ?? undefined),
  ),
);
