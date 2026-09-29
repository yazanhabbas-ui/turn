import { z } from "zod";
import { localizedText } from "@/domain/validation";
import { cloneRole } from "@/server/admin/roles";
import { route } from "@/server/http/route";

export const POST = route(
  { permission: "roles.manage", body: z.object({ name: localizedText({ max: 80 }) }) },
  async ({ actor, body, params }) => cloneRole(actor, params.id, body.name),
);
