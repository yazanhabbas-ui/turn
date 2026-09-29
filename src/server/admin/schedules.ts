import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { holidays, pauseWindows, scheduleRules, schedules, visitReasons } from "@/db/schema";
import { isoDate, localizedText, timeOfDay, uuid, weekdays } from "@/domain/validation";
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

export const pauseInput = z
  .object({
    branchId: uuid,
    kind: z.enum(["prayer", "custom"]),
    name: localizedText({ max: 80 }),
    mode: z.enum(["manual", "auto"]),
    prayer: z.enum(["fajr", "dhuhr", "asr", "maghrib", "isha"]).nullable().optional(),
    startsAt: timeOfDay.nullable().optional(),
    endsAt: timeOfDay.nullable().optional(),
    offsetMinutes: z.number().int().min(-60).max(120).default(0),
    durationMinutes: z.number().int().min(5).max(120).default(20),
    weekdays,
    season: z.enum(["always", "ramadan", "regular"]),
    message: localizedText({ max: 200, required: false }).optional(),
    isActive: z.boolean(),
  })
  .refine((p) => (p.mode === "manual" ? !!p.startsAt && !!p.endsAt && p.startsAt < p.endsAt : !!p.prayer), {
    message: "incomplete_window",
  });

export const holidayInput = z
  .object({ branchId: uuid.nullable().optional(), name: localizedText({ max: 80 }), dateFrom: isoDate, dateTo: isoDate })
  .refine((h) => h.dateFrom <= h.dateTo, { message: "invalid_range" });

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

export async function listPauseWindows(actor: Actor) {
  requirePermission(actor, "reasons.view");
  return db()
    .select()
    .from(pauseWindows)
    .where(eq(pauseWindows.organizationId, orgOf(actor)))
    .orderBy(asc(pauseWindows.startsAt));
}

export async function savePauseWindow(actor: Actor, id: string | null, input: z.infer<typeof pauseInput>) {
  requirePermission(actor, "branches.manage", input.branchId);
  const values = {
    ...input,
    prayer: input.prayer ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    message: input.message ?? null,
  };
  if (id) {
    const [p] = await db()
      .select()
      .from(pauseWindows)
      .where(and(eq(pauseWindows.id, id), eq(pauseWindows.organizationId, orgOf(actor))));
    if (!p) throw new AppError("not_found");
    requirePermission(actor, "branches.manage", p.branchId);
    await db().update(pauseWindows).set(values).where(eq(pauseWindows.id, id));
    await audit({
      ...auditMeta(actor),
      branchId: input.branchId,
      action: "pause_window.updated",
      entityType: "pause_window",
      entityId: id,
      before: p,
      after: values,
    });
    return { id };
  }
  const [p] = await db()
    .insert(pauseWindows)
    .values({ ...values, organizationId: orgOf(actor) })
    .returning();
  await audit({
    ...auditMeta(actor),
    branchId: input.branchId,
    action: "pause_window.created",
    entityType: "pause_window",
    entityId: p.id,
    after: p,
  });
  return { id: p.id };
}

export async function deletePauseWindow(actor: Actor, id: string) {
  const [p] = await db()
    .select()
    .from(pauseWindows)
    .where(and(eq(pauseWindows.id, id), eq(pauseWindows.organizationId, orgOf(actor))));
  if (!p) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", p.branchId);
  // Pause windows are not referenced by history, so they can be deleted outright.
  await db().delete(pauseWindows).where(eq(pauseWindows.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: p.branchId,
    action: "pause_window.deleted",
    entityType: "pause_window",
    entityId: id,
    before: p,
  });
}

export async function listHolidays(actor: Actor) {
  requirePermission(actor, "reasons.view");
  return db()
    .select()
    .from(holidays)
    .where(eq(holidays.organizationId, orgOf(actor)))
    .orderBy(asc(holidays.dateFrom));
}

export async function saveHoliday(actor: Actor, id: string | null, input: z.infer<typeof holidayInput>) {
  requirePermission(actor, "branches.manage", input.branchId ?? undefined);
  const values = { ...input, branchId: input.branchId ?? null };
  if (id) {
    const [h] = await db()
      .select()
      .from(holidays)
      .where(and(eq(holidays.id, id), eq(holidays.organizationId, orgOf(actor))));
    if (!h) throw new AppError("not_found");
    await db().update(holidays).set(values).where(eq(holidays.id, id));
    await audit({
      ...auditMeta(actor),
      action: "holiday.updated",
      entityType: "holiday",
      entityId: id,
      before: h,
      after: values,
    });
    return { id };
  }
  const [h] = await db()
    .insert(holidays)
    .values({ ...values, organizationId: orgOf(actor) })
    .returning();
  await audit({ ...auditMeta(actor), action: "holiday.created", entityType: "holiday", entityId: h.id, after: h });
  return { id: h.id };
}

export async function deleteHoliday(actor: Actor, id: string) {
  const [h] = await db()
    .select()
    .from(holidays)
    .where(and(eq(holidays.id, id), eq(holidays.organizationId, orgOf(actor))));
  if (!h) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", h.branchId ?? undefined);
  await db().delete(holidays).where(eq(holidays.id, id));
  await audit({ ...auditMeta(actor), action: "holiday.deleted", entityType: "holiday", entityId: id, before: h });
}
