import { createHall, hallInput } from "@/server/halls/admin";
import { route } from "@/server/http/route";

export const POST = route({ permission: "halls.manage", body: hallInput }, async ({ actor, body, params }) =>
  createHall(actor, params.id, body),
);
