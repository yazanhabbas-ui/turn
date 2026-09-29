import { createInvite, inviteInput, listInvites } from "@/server/admin/invites";
import { route } from "@/server/http/route";

export const GET = route({ permission: "users.invite" }, async ({ actor }) => ({ items: await listInvites(actor) }));

export const POST = route(
  { permission: "users.invite", body: inviteInput, rateLimit: { name: "invite", limit: 60, windowMs: 3600_000, by: "user" } },
  async ({ actor, body }) => createInvite(actor, body),
);
