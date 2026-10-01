import { enableAgentIssuing } from "@/server/admin/coverage";
import { route } from "@/server/http/route";

/** One-click fix: let agents issue walk-in tickets in a branch that has no receptionist. */
export const POST = route({ permission: "admin.access" }, async ({ actor, params }) => enableAgentIssuing(actor, params.branchId));
