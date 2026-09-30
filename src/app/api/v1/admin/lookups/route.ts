import { listBreakTypes, listPriorityLevels } from "@/server/admin/catalog";
import { listGroups } from "@/server/admin/groups";
import { listRoles } from "@/server/admin/roles";
import { listAgents } from "@/server/admin/users";
import { listBranches } from "@/server/admin/branches";
import { listCities } from "@/server/admin/cities";
import { listShifts } from "@/server/admin/shifts";
import { branchesFor, can } from "@/domain/rbac/permissions";
import { route } from "@/server/http/route";

/** Reference data the admin forms need (pickers), fetched once per page. */
export const GET = route({ permission: "admin.access" }, async ({ actor }) => {
  const grants = actor.auth.grants;
  const [branches, cities, shifts, roles, agents, groups, priorities, breakTypes] = await Promise.all([
    listBranches(actor),
    listCities(actor),
    listShifts(actor),
    can(grants, "roles.view") ? listRoles(actor) : [],
    can(grants, "reasons.view") ? listAgents(actor) : [],
    can(grants, "reasons.view") ? listGroups(actor) : [],
    can(grants, "reasons.view") ? listPriorityLevels(actor) : [],
    can(grants, "reasons.view") ? listBreakTypes(actor) : [],
  ]);
  // Only organization-wide administrators may grant organization-wide roles.
  const organizationScope = branchesFor(grants, "users.manage") === "all";
  return { organizationScope, branches, cities, shifts, roles, agents, groups, priorities, breakTypes };
});
