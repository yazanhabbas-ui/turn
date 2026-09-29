import { z } from "zod";
import { disableTotp } from "@/server/auth/service";
import { route } from "@/server/http/route";

export const POST = route(
  {
    body: z.object({ password: z.string().min(1).max(256) }),
    rateLimit: { name: "password", limit: 10, windowMs: 60_000, by: "user" },
  },
  async ({ auth, body, ip, req }) => {
    await disableTotp(auth, body.password, { ip, userAgent: req.headers.get("user-agent") });
    return { ok: true };
  },
);
