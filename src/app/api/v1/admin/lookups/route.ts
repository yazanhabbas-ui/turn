import { listBreakTypes, listPriorityLevels } from "@/server/admin/catalog";
import { listGroups } from "@/server/admin/groups";
import { listRoles } from "@/server/admin/roles";
import { listAgents } from "@/server/admin/users";
import { listBranches } from "@/server/admin/branches";
import { can } from "@/domain/rbac/permissions";
import { route } from "@/server/http/route";

/** Reference data the admin forms need (pickers), fetched once per page. */
export const GET = route({ permission: "admin.access" }, async ({ actor }) => {
  const grants = actor.auth.grants;
  const [branches, roles, agents, groups, priorities, breakTypes] = await Promise.all([
    listBranches(actor),
    can(grants, "roles.view") ? listRoles(actor) : [],
    can(grants, "reasons.view") ? listAgents(actor) : [],
    can(grants, "reasons.view") ? listGroups(actor) : [],
    can(grants, "reasons.view") ? listPriorityLevels(actor) : [],
    can(grants, "reasons.view") ? listBreakTypes(actor) : [],
  ]);
  return { branches, roles, agents, groups, priorities, breakTypes };
});
