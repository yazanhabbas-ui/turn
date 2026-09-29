import { z } from "zod";
import { completePasswordReset, describeResetToken } from "@/server/admin/users";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";

const limit = { name: "reset-public", limit: 30, windowMs: 60_000 };

export const GET = route({ auth: "public", rateLimit: limit }, async ({ params }) => {
  const info = await describeResetToken(params.token);
  if (!info) throw new AppError("not_found", { reason: "invalid_or_expired" });
  return info;
});

export const POST = route(
  { auth: "public", body: z.object({ password: z.string().min(1).max(256) }), rateLimit: limit },
  async ({ params, body, ip, req }) => {
    await completePasswordReset(params.token, body.password, { ip, userAgent: req.headers.get("user-agent") });
    return { ok: true };
  },
);
