import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { breakTypes, priorityLevels } from "@/db/schema";
import { hexColor, localizedText } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const priorityInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: localizedText({ max: 80 }),
  weight: z.number().int().min(0).max(1000),
  isLane: z.boolean(),
  color: hexColor,
  icon: z.string().max(60).nullable().optional(),
  sortOrder: z.number().int().default(0),
});

export const breakTypeInput = z.object({
  name: localizedText({ max: 80 }),
  maxMinutes: z.number().int().min(1).max(480).nullable().optional(),
  countsAsProductive: z.boolean(),
  sortOrder: z.number().int().default(0),
});

export async function listPriorityLevels(actor: Actor) {
  requirePermission(actor, "reasons.view");
  return db()
    .select()
    .from(priorityLevels)
    .where(and(eq(priorityLevels.organizationId, orgOf(actor)), isNull(priorityLevels.archivedAt)))
    .orderBy(asc(priorityLevels.sortOrder));
}

export async function savePriorityLevel(actor: Actor, id: string | null, input: z.infer<typeof priorityInput>) {
  requireOrgWide(actor, "distribution.manage");
  const org = orgOf(actor);
  const [dup] = await db()
    .select({ id: priorityLevels.id })
    .from(priorityLevels)
    .where(
      and(eq(priorityLevels.organizationId, org), eq(priorityLevels.key, input.key), id ? ne(priorityLevels.id, id) : undefined),
    );
  if (dup) throw new AppError("conflict", { field: "key" });
  const values = { ...input, icon: input.icon ?? null };
  if (id) {
    const [before] = await db()
      .select()
      .from(priorityLevels)
      .where(and(eq(priorityLevels.id, id), eq(priorityLevels.organizationId, org)));
    if (!before) throw new AppError("not_found");
    await db().update(priorityLevels).set(values).where(eq(priorityLevels.id, id));
    await audit({
      ...auditMeta(actor),
      action: "priority.updated",
      entityType: "priority_level",
      entityId: id,
      before,
      after: values,
    });
    return { id };
  }
  const [p] = await db()
    .insert(priorityLevels)
    .values({ ...values, organizationId: org })
    .returning();
  await audit({ ...auditMeta(actor), action: "priority.created", entityType: "priority_level", entityId: p.id, after: p });
  return { id: p.id };
}

export async function archivePriorityLevel(actor: Actor, id: string) {
  requireOrgWide(actor, "distribution.manage");
  const [p] = await db()
    .select()
    .from(priorityLevels)
    .where(and(eq(priorityLevels.id, id), eq(priorityLevels.organizationId, orgOf(actor))));
  if (!p) throw new AppError("not_found");
  if (p.key === "normal") throw new AppError("conflict", { reason: "builtin_priority" });
  await db().update(priorityLevels).set({ archivedAt: new Date() }).where(eq(priorityLevels.id, id));
  await audit({ ...auditMeta(actor), action: "priority.archived", entityType: "priority_level", entityId: id, before: p });
}

export async function listBreakTypes(actor: Actor) {
  requirePermission(actor, "reasons.view");
  return db()
    .select()
    .from(breakTypes)
    .where(and(eq(breakTypes.organizationId, orgOf(actor)), isNull(breakTypes.archivedAt)))
    .orderBy(asc(breakTypes.sortOrder));
}

export async function saveBreakType(actor: Actor, id: string | null, input: z.infer<typeof breakTypeInput>) {
  requireOrgWide(actor, "settings.manage");
  const values = { ...input, maxMinutes: input.maxMinutes ?? null };
  if (id) {
    const [before] = await db()
      .select()
      .from(breakTypes)
      .where(and(eq(breakTypes.id, id), eq(breakTypes.organizationId, orgOf(actor))));
    if (!before) throw new AppError("not_found");
    await db().update(breakTypes).set(values).where(eq(breakTypes.id, id));
    await audit({
      ...auditMeta(actor),
      action: "break_type.updated",
      entityType: "break_type",
      entityId: id,
      before,
      after: values,
    });
    return { id };
  }
  const [b] = await db()
    .insert(breakTypes)
    .values({ ...values, organizationId: orgOf(actor) })
    .returning();
  await audit({ ...auditMeta(actor), action: "break_type.created", entityType: "break_type", entityId: b.id, after: b });
  return { id: b.id };
}

export async function archiveBreakType(actor: Actor, id: string) {
  requireOrgWide(actor, "settings.manage");
  const [b] = await db()
    .select()
    .from(breakTypes)
    .where(and(eq(breakTypes.id, id), eq(breakTypes.organizationId, orgOf(actor))));
  if (!b) throw new AppError("not_found");
  await db().update(breakTypes).set({ archivedAt: new Date() }).where(eq(breakTypes.id, id));
  await audit({ ...auditMeta(actor), action: "break_type.archived", entityType: "break_type", entityId: id, before: b });
}
