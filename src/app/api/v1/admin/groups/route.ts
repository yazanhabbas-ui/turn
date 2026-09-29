import { groupInput, listGroups, saveGroup } from "@/server/admin/groups";
import { route } from "@/server/http/route";

export const GET = route({ permission: "reasons.view" }, async ({ actor }) => ({ items: await listGroups(actor) }));

export const POST = route({ permission: "reasons.manage", body: groupInput }, async ({ actor, body }) =>
  saveGroup(actor, null, body),
);
