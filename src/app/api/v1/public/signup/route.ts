import { requestSignup, signupInput } from "@/server/admin/signups";
import { route } from "@/server/http/route";

export const POST = route(
  { auth: "public", body: signupInput, rateLimit: { name: "signup-public", limit: 5, windowMs: 3600_000 } },
  async ({ body, ip, req }) => requestSignup(body, { ip, userAgent: req.headers.get("user-agent") }),
);
