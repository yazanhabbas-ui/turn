import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { scheduleRules, schedules, visitReasons } from "@/db/schema";
import { isoDate, localizedText, timeOfDay } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

const ruleInput = z
  .object({
    kind: z.enum(["regular", "ramadan", "special"]),
    weekday: z.number().int().min(0).max(6),
    opensAt: timeOfDay,
    closesAt: timeOfDay,
    validFrom: isoDate.nullable().optional(),
    validTo: isoDate.nullable().optional(),
  })
  .refine((r) => r.opensAt < r.closesAt, { message: "closes_before_opens" });

export const scheduleInput = z.object({ name: localizedText({ max: 80 }), rules: z.array(ruleInput).max(100) });

export async function listSchedules(actor: Actor) {
  requirePermission(actor, "reasons.view");
  const org = orgOf(actor);
  const rows = await db()
    .select()
    .from(schedules)
    .where(and(eq(schedules.organizationId, org), isNull(schedules.archivedAt)))
    .orderBy(asc(schedules.createdAt));
  const ids = rows.map((s) => s.id);
  const rules = ids.length
    ? await db()
        .select()
        .from(scheduleRules)
        .where(inArray(scheduleRules.scheduleId, ids))
        .orderBy(asc(scheduleRules.weekday), asc(scheduleRules.opensAt))
    : [];
  return rows.map((s) => ({ ...s, rules: rules.filter((r) => r.scheduleId === s.id) }));
}

export async function saveSchedule(actor: Actor, id: string | null, input: z.infer<typeof scheduleInput>) {
  requireOrgWide(actor, "reasons.manage");
  return db().transaction(async (tx) => {
    let scheduleId = id;
    if (id) {
      const [s] = await tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.organizationId, orgOf(actor)), isNull(schedules.archivedAt)));
      if (!s) throw new AppError("not_found");
      await tx.update(schedules).set({ name: input.name }).where(eq(schedules.id, id));
      await tx.delete(scheduleRules).where(eq(scheduleRules.scheduleId, id));
    } else {
      const [s] = await tx
        .insert(schedules)
        .values({ organizationId: orgOf(actor), name: input.name })
        .returning();
      scheduleId = s.id;
    }
    if (input.rules.length) {
      await tx
        .insert(scheduleRules)
        .values(
          input.rules.map((r) => ({ ...r, scheduleId: scheduleId!, validFrom: r.validFrom ?? null, validTo: r.validTo ?? null })),
        );
    }
    await audit(
      {
        ...auditMeta(actor),
        action: id ? "schedule.updated" : "schedule.created",
        entityType: "schedule",
        entityId: scheduleId,
        after: input,
      },
      tx,
    );
    return { id: scheduleId! };
  });
}

export async function archiveSchedule(actor: Actor, id: string) {
  requireOrgWide(actor, "reasons.manage");
  const [inUse] = await db()
    .select({ id: visitReasons.id })
    .from(visitReasons)
    .where(and(eq(visitReasons.scheduleId, id), isNull(visitReasons.archivedAt)))
    .limit(1);
  if (inUse) throw new AppError("conflict", { reason: "schedule_in_use" });
  const [s] = await db()
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.organizationId, orgOf(actor))));
  if (!s) throw new AppError("not_found");
  await db().update(schedules).set({ archivedAt: new Date() }).where(eq(schedules.id, id));
  await audit({ ...auditMeta(actor), action: "schedule.archived", entityType: "schedule", entityId: id, before: s });
}
