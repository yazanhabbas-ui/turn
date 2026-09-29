import { NextResponse } from "next/server";
import { acceptInvite, acceptInviteInput, describeInvite } from "@/server/admin/invites";
import { AppError } from "@/server/http/errors";
import { route, setSessionCookie } from "@/server/http/route";

const limit = { name: "invite-public", limit: 30, windowMs: 60_000 };

export const GET = route({ auth: "public", rateLimit: limit }, async ({ params }) => {
  const invite = await describeInvite(params.token);
  if (!invite) throw new AppError("not_found", { reason: "invalid_or_expired" });
  return invite;
});

export const POST = route({ auth: "public", body: acceptInviteInput, rateLimit: limit }, async ({ params, body, ip, req }) => {
  const result = await acceptInvite(params.token, body, { ip, userAgent: req.headers.get("user-agent") });
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, result.token, result.expiresAt);
  return res;
});
