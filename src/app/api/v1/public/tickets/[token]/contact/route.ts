import { z } from "zod";
import { route } from "@/server/http/route";
import { addVisitorContact } from "@/server/notifications/optin";

/** A visitor who has no phone on the ticket asks for updates: adds their number and their consent. */
export const POST = route(
  {
    auth: "public",
    body: z.object({ phone: z.string().trim().min(6).max(30), consent: z.literal(true) }),
    rateLimit: { name: "notify-optin", limit: 10, windowMs: 60_000 },
  },
  async ({ params, body }) => addVisitorContact(params.token, body.phone),
);
