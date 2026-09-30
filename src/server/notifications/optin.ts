import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets, visitors } from "@/db/schema";
import { normalizePhone } from "@/domain/tickets/phone";
import { hashPhone } from "../crypto";
import { AppError } from "../http/errors";
import { providerFor } from "../messaging/providers";
import { getSetting } from "../settings/service";

/**
 * A visitor without a phone on the ticket asks for updates from the status page. Their number and their agreement
 * (the tick box) are stored on the ticket's visitor, exactly like consent given at reception.
 */
export async function addVisitorContact(token: string, rawPhone: string): Promise<{ ok: true }> {
  const [t] = await db().select().from(tickets).where(eq(tickets.publicToken, token));
  if (!t || !["WAITING", "CALLED", "SERVING", "ON_HOLD"].includes(t.status)) throw new AppError("not_found");
  const { phoneCountryCode } = await getSetting(t.organizationId, "regional", t.branchId);
  const phone = normalizePhone(rawPhone, phoneCountryCode);
  if (!phone) throw new AppError("validation", { field: "phone" });
  const phoneHash = hashPhone(phone);
  const now = new Date();

  await db().transaction(async (tx) => {
    const [current] = t.visitorId ? await tx.select().from(visitors).where(eq(visitors.id, t.visitorId)) : [];
    if (current?.phone) throw new AppError("conflict", { reason: "already_has_phone" });
    // A returning visitor keeps their history (and their earlier opt-out).
    const [known] = await tx
      .select()
      .from(visitors)
      .where(and(eq(visitors.organizationId, t.organizationId), eq(visitors.phoneHash, phoneHash)))
      .limit(1);
    let visitorId: string;
    if (known) {
      visitorId = known.id;
    } else if (current) {
      await tx.update(visitors).set({ phone, phoneHash }).where(eq(visitors.id, current.id));
      visitorId = current.id;
    } else {
      const [v] = await tx
        .insert(visitors)
        .values({ organizationId: t.organizationId, phone, phoneHash, preferredLanguage: t.language })
        .returning({ id: visitors.id });
      visitorId = v.id;
    }
    // Only these two columns change, so an agent's concurrent action on the ticket is not disturbed.
    await tx.update(tickets).set({ visitorId, consentAt: now }).where(eq(tickets.id, t.id));
  });
  return { ok: true };
}

/** Whether the status page should offer "get updates on my phone" for this ticket. */
export async function canOfferUpdates(t: typeof tickets.$inferSelect): Promise<boolean> {
  if (!["WAITING", "CALLED"].includes(t.status)) return false;
  const settings = await getSetting(t.organizationId, "notifications", t.branchId);
  if (!settings.enabled) return false;
  const usable = settings.channelOrder.some(
    (c) => c !== "email" && providerFor(c) && Object.values(settings.events).some((e) => e.enabled && e.channels[c]),
  );
  if (!usable) return false;
  if (!t.visitorId) return true;
  const [v] = await db()
    .select({ phone: visitors.phone, out: visitors.notificationsOptOut })
    .from(visitors)
    .where(eq(visitors.id, t.visitorId));
  return !v?.phone && !v?.out;
}
