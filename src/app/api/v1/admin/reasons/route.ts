import { createReason, listReasons, reasonInput } from "@/server/admin/reasons";
import { route } from "@/server/http/route";

export const GET = route({ permission: "reasons.view" }, async ({ actor, query }) => ({
  items: await listReasons(actor, { includeArchived: query.get("archived") === "true" }),
}));

export const POST = route({ permission: "reasons.manage", body: reasonInput }, async ({ actor, body }) =>
  createReason(actor, body),
);
