import { z } from "zod";
import { INVITE_CHANNELS, resendInvite, revokeInvite } from "@/server/admin/invites";
import { route } from "@/server/http/route";

/** Resend: rotates the token (the previous link stops working) and delivers again. */
export const POST = route(
  { permission: "users.invite", body: z.object({ channels: z.array(z.enum(INVITE_CHANNELS)).max(3).default([]) }) },
  async ({ actor, body, params }) => resendInvite(actor, params.id, body.channels),
);

export const DELETE = route({ permission: "users.invite" }, async ({ actor, params }) => {
  await revokeInvite(actor, params.id);
  return { ok: true };
});
