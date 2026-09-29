import { NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/server/auth/service";
import { route, setSessionCookie } from "@/server/http/route";

export const POST = route(
  {
    auth: "public",
    body: z.object({
      email: z.string().email().max(320),
      password: z.string().min(1).max(256),
      organization: z.string().max(100).optional(),
    }),
    rateLimit: { name: "login", limit: 20, windowMs: 60_000 },
  },
  async ({ body, ip, req }) => {
    const result = await login(body, { ip, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ status: result.totpRequired ? "totp_required" : "ok" });
    setSessionCookie(res, result.token, result.expiresAt);
    return res;
  },
);
