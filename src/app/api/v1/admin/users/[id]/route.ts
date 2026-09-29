import { updateUser, userInput } from "@/server/admin/users";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "users.manage", body: userInput }, async ({ actor, body, params }) => {
  await updateUser(actor, params.id, body);
  return { ok: true };
});
