import { z } from "zod";
import { route } from "@/server/http/route";
import { retentionOverview, runRetentionNow } from "@/server/privacy/admin";

/** Last retention run (organization-wide settings administrators). */
export const GET = route({ permission: "settings.manage" }, ({ actor }) => retentionOverview(actor));

/** `{ dryRun: true }` previews the counts; `{ dryRun: false }` runs the retention job now. */
export const POST = route({ permission: "settings.manage", body: z.object({ dryRun: z.boolean() }) }, ({ actor, body }) =>
  runRetentionNow(actor, body.dryRun),
);
