import { rejectSignup, rejectSignupInput } from "@/server/admin/signups";
import { route } from "@/server/http/route";

export const POST = route({ permission: "users.invite", body: rejectSignupInput }, async ({ actor, body, params }) =>
  rejectSignup(actor, params.id, body),
);
