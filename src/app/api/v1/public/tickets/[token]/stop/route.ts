import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { optOutByToken } from "@/server/notifications/optout";

/** The visitor's STOP link: stops all further messages. The signature comes from the link in the message. */
export const POST = route(
  {
    auth: "public",
    body: z.object({ s: z.string().min(8).max(64) }),
    rateLimit: { name: "notify-stop", limit: 20, windowMs: 60_000 },
  },
  async ({ params, body }) => {
    const r = await optOutByToken(params.token, body.s);
    if (r === "invalid") throw new AppError("not_found");
    return { ok: true };
  },
);
