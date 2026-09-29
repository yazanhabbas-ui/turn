import { NextResponse } from "next/server";
import { invalidateSession } from "@/server/auth/session";
import { clearSessionCookie, route } from "@/server/http/route";

export const POST = route({ auth: "public" }, async ({ auth }) => {
  if (auth) await invalidateSession(auth.sessionId);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
