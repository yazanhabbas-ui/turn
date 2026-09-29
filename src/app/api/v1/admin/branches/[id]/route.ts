import { archiveBranch, branchInput, updateBranch } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "branches.manage", body: branchInput }, async ({ actor, body, params }) => {
  await updateBranch(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "branches.manage" }, async ({ actor, params }) => {
  await archiveBranch(actor, params.id);
  return { ok: true };
});
