import { createRole, listRoles, roleInput } from "@/server/admin/roles";
import { route } from "@/server/http/route";

export const GET = route({ permission: "roles.view" }, async ({ actor }) => ({ items: await listRoles(actor) }));

export const POST = route({ permission: "roles.manage", body: roleInput }, async ({ actor, body }) => createRole(actor, body));
