import { createUser, createUserInput, listUsers } from "@/server/admin/users";
import { route } from "@/server/http/route";

export const GET = route({ permission: "users.view" }, async ({ actor, query }) => ({
  items: await listUsers(actor, {
    q: query.get("q") ?? undefined,
    roleId: query.get("roleId") ?? undefined,
    branchId: query.get("branchId") ?? undefined,
    status: query.get("status") ?? undefined,
  }),
}));

export const POST = route({ permission: "users.manage", body: createUserInput }, async ({ actor, body }) =>
  createUser(actor, body),
);
