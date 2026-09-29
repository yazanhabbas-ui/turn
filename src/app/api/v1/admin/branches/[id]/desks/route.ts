import { createDesk, deskInput } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const POST = route({ permission: "branches.manage", body: deskInput }, async ({ actor, body, params }) =>
  createDesk(actor, params.id, body),
);
