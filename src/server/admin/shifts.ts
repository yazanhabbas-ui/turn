import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentProfiles, branches, cities, shifts } from "@/db/schema";
import { localizedText, timeOfDay } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { allowedCities, auditMeta, orgOf, requireCityAccess, requireOrgWide, requirePermission, type Actor } from "./actor";

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
    /** Null = an organization-wide shift (every agent may use it); a city id = only that city's agents. */
    cityId: z.string().uuid().nullable().default(null),
  })
  .refine((s) => s.startsAt !== s.endsAt, { message: "same_time" });

/**
 * Organization-wide shifts plus the shifts of the cities the actor can see (all of them for organization-wide
 * administrators), so a city admin never sees another city's shifts.
 */
export async function listShifts(actor: Actor) {
  requirePermission(actor, "admin.access");
  const scope = allowedCities(actor, "admin.access");
  const own = scope === "all" ? [] : scope;
  // A branch-level manager's city is reachable through the branches they can see.
  const viaBranches =
    scope === "all"
      ? []
      : (await db().select({ cityId: branches.cityId, id: branches.id }).from(branches)).filter((b) =>
          actor.auth.grants.some((g) => g.permissions.includes("admin.access") && g.branchId === b.id),
        );
  const cityIds = [...new Set([...own, ...viaBranches.map((b) => b.cityId)])];
  return db()
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, orgOf(actor)),
        isNull(shifts.archivedAt),
        scope === "all" ? undefined : or(isNull(shifts.cityId), cityIds.length ? inArray(shifts.cityId, cityIds) : undefined),
      ),
    )
    .orderBy(asc(shifts.sortOrder), asc(shifts.startsAt));
}

/** Organization shifts need organization-wide settings rights; a city's shift needs city-wide branch management. */
async function requireShiftWrite(actor: Actor, cityId: string | null) {
  if (!cityId) return requireOrgWide(actor, "settings.manage");
  const [c] = await db().select({ organizationId: cities.organizationId }).from(cities).where(eq(cities.id, cityId));
  if (!c || c.organizationId !== orgOf(actor)) throw new AppError("not_found");
  requireCityAccess(actor, "branches.manage", cityId);
}

async function load(actor: Actor, id: string) {
  const [s] = await db()
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.organizationId, orgOf(actor)), isNull(shifts.archivedAt)));
  if (!s) throw new AppError("not_found");
  return s;
}

/**
 * Shifts are defined once for the organization (super admin, `cityId` null); a city admin may also define shifts that
 * belong to their city. Agents pick from the organization's shifts and their own city's.
 */
export async function createShift(actor: Actor, input: z.infer<typeof shiftInput>) {
  await requireShiftWrite(actor, input.cityId);
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
  const before = await load(actor, id);
  // A shift cannot move between the organization and cities, or between cities: archive and recreate instead.
  if ((input.cityId ?? null) !== before.cityId) throw new AppError("validation", { field: "cityId" });
  await requireShiftWrite(actor, before.cityId);
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
  const before = await load(actor, id);
  await requireShiftWrite(actor, before.cityId);
  const [inUse] = await db()
    .select({ id: agentProfiles.userId })
    .from(agentProfiles)
    .where(eq(agentProfiles.shiftId, id))
    .limit(1);
  if (inUse) throw new AppError("conflict", { reason: "shift_in_use" });
  await db().update(shifts).set({ archivedAt: new Date() }).where(eq(shifts.id, id));
  await audit({ ...auditMeta(actor), action: "shift.archived", entityType: "shift", entityId: id, before });
}
