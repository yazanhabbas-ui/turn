import { createFloor, floorInput } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const POST = route({ permission: "branches.manage", body: floorInput }, async ({ actor, body, params }) =>
  createFloor(actor, params.id, body),
);
