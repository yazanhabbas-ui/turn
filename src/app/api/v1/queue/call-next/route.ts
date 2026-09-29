import { z } from "zod";
import { uuid } from "@/domain/validation";
import { callNext } from "@/server/queue/tickets";
import { route } from "@/server/http/route";

/** Returns `{ ticket }` or `{ ticket: null, reason: "empty" | "at_capacity" | "not_working" }`. */
export const POST = route(
  { permission: "agent.serve", body: z.object({ deskId: uuid.nullable().optional() }) },
  async ({ actor, body }) => callNext(actor, body),
);
