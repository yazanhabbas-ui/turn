import { branchInput, createBranch, listBranches } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const GET = route({ permission: "admin.access" }, async ({ actor }) => ({ items: await listBranches(actor) }));

export const POST = route({ permission: "branches.manage", body: branchInput }, async ({ actor, body }) =>
  createBranch(actor, body),
);
