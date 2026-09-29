import { z } from "zod";
import { verifySecondFactor } from "@/server/auth/service";
import { route } from "@/server/http/route";

export const POST = route(
  {
    auth: "pending2fa",
    body: z.object({ code: z.string().min(6).max(10) }),
    rateLimit: { name: "totp", limit: 10, windowMs: 60_000, by: "user" },
  },
  async ({ auth, body, ip, req }) => {
    await verifySecondFactor(auth, body.code, { ip, userAgent: req.headers.get("user-agent") });
    return { ok: true };
  },
);
