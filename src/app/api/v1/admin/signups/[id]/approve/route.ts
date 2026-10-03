import { approveSignup, approveSignupInput } from "@/server/admin/signups";
import { route } from "@/server/http/route";

export const POST = route({ permission: "users.invite", body: approveSignupInput }, async ({ actor, body, params }) =>
  approveSignup(actor, params.id, body),
);
