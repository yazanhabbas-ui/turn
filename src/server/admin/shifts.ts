import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentProfiles, shifts } from "@/db/schema";
import { localizedText, timeOfDay } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const shiftInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: localizedText({ max: 60 }),
    startsAt: timeOfDay,
    endsAt: timeOfDay,
    sortOrder: z.number().int().min(0).max(99).default(0),
  })
  .refine((s) => s.startsAt !== s.endsAt, { message: "same_time" });

export async function listShifts(actor: Actor) {
  requirePermission(actor, "admin.access");
  return db()
    .select()
    .from(shifts)
    .where(and(eq(shifts.organizationId, orgOf(actor)), isNull(shifts.archivedAt)))
    .orderBy(asc(shifts.sortOrder), asc(shifts.startsAt));
}

async function load(actor: Actor, id: string) {
  const [s] = await db()
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.organizationId, orgOf(actor)), isNull(shifts.archivedAt)));
  if (!s) throw new AppError("not_found");
  return s;
}

/** Shifts are defined once for the organization (super admin); city admins assign their agents to them. */
export async function createShift(actor: Actor, input: z.infer<typeof shiftInput>) {
  requireOrgWide(actor, "settings.manage");
  const [dup] = await db()
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.organizationId, orgOf(actor)), eq(shifts.code, input.code)));
  if (dup) throw new AppError("conflict", { field: "code" });
  const [s] = await db()
    .insert(shifts)
    .values({ ...input, organizationId: orgOf(actor) })
    .returning();
  await audit({ ...auditMeta(actor), action: "shift.created", entityType: "shift", entityId: s.id, after: s });
  return { id: s.id };
}

export async function updateShift(actor: Actor, id: string, input: z.infer<typeof shiftInput>) {
  requireOrgWide(actor, "settings.manage");
  const before = await load(actor, id);
  const [dup] = await db()
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.organizationId, before.organizationId), eq(shifts.code, input.code), ne(shifts.id, id)));
  if (dup) throw new AppError("conflict", { field: "code" });
  const [after] = await db()
    .update(shifts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(shifts.id, id))
    .returning();
  await audit({ ...auditMeta(actor), action: "shift.updated", entityType: "shift", entityId: id, before, after });
}

export async function archiveShift(actor: Actor, id: string) {
  requireOrgWide(actor, "settings.manage");
  const before = await load(actor, id);
  const [inUse] = await db()
    .select({ id: agentProfiles.userId })
    .from(agentProfiles)
    .where(eq(agentProfiles.shiftId, id))
    .limit(1);
  if (inUse) throw new AppError("conflict", { reason: "shift_in_use" });
  await db().update(shifts).set({ archivedAt: new Date() }).where(eq(shifts.id, id));
  await audit({ ...auditMeta(actor), action: "shift.archived", entityType: "shift", entityId: id, before });
}
