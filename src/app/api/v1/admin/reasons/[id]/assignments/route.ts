import { assignmentsInput, setAssignments } from "@/server/admin/reasons";
import { route } from "@/server/http/route";

/** Replaces the full list of agents and groups that serve this reason. */
export const PUT = route({ permission: "reasons.manage", body: assignmentsInput }, async ({ actor, body, params }) => {
  await setAssignments(actor, params.id, body);
  return { ok: true };
});
