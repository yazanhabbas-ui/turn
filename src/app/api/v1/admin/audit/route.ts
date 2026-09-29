import { listAudit } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

export const GET = route({ permission: "audit.view" }, async ({ actor, query }) =>
  listAudit(actor, {
    entityType: query.get("entityType") ?? undefined,
    actorUserId: query.get("actorUserId") ?? undefined,
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
    before: query.get("before") ?? undefined,
    limit: query.get("limit") ? Number(query.get("limit")) : undefined,
  }),
);
