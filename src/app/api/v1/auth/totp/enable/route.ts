import { z } from "zod";
import { confirmTotpSetup } from "@/server/auth/service";
import { route } from "@/server/http/route";

export const POST = route(
  { body: z.object({ code: z.string().min(6).max(10) }), rateLimit: { name: "totp", limit: 10, windowMs: 60_000, by: "user" } },
  async ({ auth, body, ip, req }) => {
    await confirmTotpSetup(auth, body.code, { ip, userAgent: req.headers.get("user-agent") });
    return { ok: true };
  },
);
