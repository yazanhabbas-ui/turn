import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationsLog, tickets, visitors } from "@/db/schema";
import { env } from "../env";
import { safeEqual } from "../crypto";

/** Signature of the opt-out link, bound to the ticket's public token. */
export function signStop(token: string): string {
  return createHmac("sha256", env().PHONE_HASH_KEY).update(`stop:${token}`).digest("hex").slice(0, 32);
}

export const verifyStop = (token: string, sig: string) => safeEqual(signStop(token), sig);

/**
 * Stops all further messages to the visitor of this ticket: the flag lives on the visitor, so it is honoured on every
 * channel and on later visits. Messages already waiting to be sent are cancelled.
 */
export async function optOutByToken(token: string, sig: string): Promise<"ok" | "invalid" | "no_visitor"> {
  if (!verifyStop(token, sig)) return "invalid";
  const [t] = await db().select().from(tickets).where(eq(tickets.publicToken, token));
  if (!t) return "invalid";
  if (!t.visitorId) return "no_visitor";
  await db()
    .update(visitors)
    .set({ notificationsOptOut: true, notificationsOptOutAt: new Date() })
    .where(eq(visitors.id, t.visitorId));
  const mine = await db().select({ id: tickets.id }).from(tickets).where(eq(tickets.visitorId, t.visitorId));
  if (mine.length)
    await db()
      .update(notificationsLog)
      .set({ status: "skipped", error: "opted_out" })
      .where(
        and(
          inArray(
            notificationsLog.ticketId,
            mine.map((m) => m.id),
          ),
          inArray(notificationsLog.status, ["queued", "sending"]),
        ),
      );
  return "ok";
}
