import { z } from "zod";
import { pairDevice } from "@/server/display/device";
import { route } from "@/server/http/route";

/** A screen exchanges the admin's pairing code for its long-lived device token (returned once). */
export const POST = route(
  {
    auth: "public",
    body: z.object({ code: z.string().trim().min(4).max(12) }),
    rateLimit: { name: "display-pair", limit: 10, windowMs: 60_000 },
  },
  async ({ body, ip, req }) => pairDevice(body.code, { ip, userAgent: req.headers.get("user-agent") }),
);
