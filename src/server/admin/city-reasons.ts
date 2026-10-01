import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { cities, cityReasons, visitReasons } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requireCityAccess, type Actor } from "./actor";

export const cityReasonInput = z.object({ reasonId: z.string().uuid(), enabled: z.boolean() });

async function loadCityFor(actor: Actor, cityId: string, write: boolean) {
  const [c] = await db().select({ organizationId: cities.organizationId }).from(cities).where(eq(cities.id, cityId));
  if (!c || c.organizationId !== orgOf(actor)) throw new AppError("not_found");
  requireCityAccess(actor, write ? "branches.manage" : "admin.access", cityId);
}

/** Every active organization reason with whether this city has it enabled (the default for all of them). */
export async function listCityReasons(actor: Actor, cityId: string) {
  await loadCityFor(actor, cityId, false);
  const [reasons, rows] = await Promise.all([
    db()
      .select({
        id: visitReasons.id,
        code: visitReasons.code,
        name: visitReasons.name,
        prefix: visitReasons.prefix,
        color: visitReasons.color,
      })
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, orgOf(actor)), isNull(visitReasons.archivedAt)))
      .orderBy(asc(visitReasons.sortOrder)),
    db().select().from(cityReasons).where(eq(cityReasons.cityId, cityId)),
  ]);
  return reasons.map((r) => ({ ...r, enabled: rows.find((x) => x.reasonId === r.id)?.enabled ?? true }));
}

/** Enables or hides one organization reason in a city. Re-enabling removes the row (back to the default). */
export async function setCityReason(actor: Actor, cityId: string, input: z.infer<typeof cityReasonInput>) {
  await loadCityFor(actor, cityId, true);
  const org = orgOf(actor);
  const [reason] = await db()
    .select({ id: visitReasons.id })
    .from(visitReasons)
    .where(and(eq(visitReasons.id, input.reasonId), eq(visitReasons.organizationId, org)));
  if (!reason) throw new AppError("not_found");
  if (input.enabled) {
    await db()
      .delete(cityReasons)
      .where(and(eq(cityReasons.cityId, cityId), eq(cityReasons.reasonId, input.reasonId)));
  } else {
    await db()
      .insert(cityReasons)
      .values({ organizationId: org, cityId, reasonId: input.reasonId, enabled: false, updatedByUserId: actor.auth.user.id })
      .onConflictDoUpdate({
        target: [cityReasons.cityId, cityReasons.reasonId],
        set: { enabled: false, updatedByUserId: actor.auth.user.id, updatedAt: new Date() },
      });
  }
  await audit({
    ...auditMeta(actor),
    action: "city.reason_toggled",
    entityType: "city",
    entityId: cityId,
    after: { reasonId: input.reasonId, enabled: input.enabled },
  });
}
