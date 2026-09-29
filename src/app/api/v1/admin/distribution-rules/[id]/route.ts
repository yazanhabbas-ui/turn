import { deleteRule } from "@/server/admin/distribution";
import { route } from "@/server/http/route";

/** Removes a branch/queue override so it inherits again. */
export const DELETE = route({ permission: "distribution.manage" }, async ({ actor, params }) => {
  await deleteRule(actor, params.id);
  return { ok: true };
});
