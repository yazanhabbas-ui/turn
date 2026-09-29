import { NextResponse } from "next/server";
import { z } from "zod";
import { changePassword } from "@/server/auth/service";
import { route, setSessionCookie } from "@/server/http/route";

export const POST = route(
  {
    body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }),
    rateLimit: { name: "password", limit: 10, windowMs: 60_000, by: "user" },
  },
  async ({ auth, body, ip, req }) => {
    const session = await changePassword(auth, body, { ip, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  },
);
