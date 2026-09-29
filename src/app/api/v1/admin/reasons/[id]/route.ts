import { z } from "zod";
import { reasonInput, setReasonArchived, updateReason } from "@/server/admin/reasons";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "reasons.manage", body: reasonInput }, async ({ actor, body, params }) => {
  await updateReason(actor, params.id, body);
  return { ok: true };
});

/** Archive / restore. Reasons are never hard-deleted because tickets reference them. */
export const PATCH = route(
  { permission: "reasons.manage", body: z.object({ archived: z.boolean() }) },
  async ({ actor, body, params }) => {
    await setReasonArchived(actor, params.id, body.archived);
    return { ok: true };
  },
);
