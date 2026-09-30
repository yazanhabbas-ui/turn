import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, cities } from "@/db/schema";
import { localizedText } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { allowedCities, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";
import { visibleBranchIds } from "./branches";

export const cityInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: localizedText({ max: 120 }),
});

/** Cities the actor can see: those they hold a grant on, plus the cities of the branches they can see. */
export async function listCities(actor: Actor) {
  requirePermission(actor, "admin.access");
  const org = orgOf(actor);
  const all = await db()
    .select()
    .from(cities)
    .where(and(eq(cities.organizationId, org), isNull(cities.archivedAt)))
    .orderBy(asc(cities.createdAt));
  const branchIds = await visibleBranchIds(actor, "admin.access");
  const inBranches = branchIds.length
    ? await db().select({ id: branches.id, cityId: branches.cityId }).from(branches).where(inArray(branches.id, branchIds))
    : [];
  const granted = allowedCities(actor, "admin.access");
  const visible = all.filter((c) => granted === "all" || granted.includes(c.id) || inBranches.some((b) => b.cityId === c.id));
  const counts = new Map<string, number>();
  const live = await db()
    .select({ cityId: branches.cityId })
    .from(branches)
    .where(and(eq(branches.organizationId, org), isNull(branches.archivedAt)));
  for (const b of live) counts.set(b.cityId, (counts.get(b.cityId) ?? 0) + 1);
  return visible.map((c) => ({ ...c, branchCount: counts.get(c.id) ?? 0 }));
}

export async function createCity(actor: Actor, input: z.infer<typeof cityInput>) {
  requireOrgWide(actor, "cities.manage");
  const org = orgOf(actor);
  const [dup] = await db()
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.organizationId, org), eq(cities.code, input.code)));
  if (dup) throw new AppError("conflict", { field: "code" });
  const [c] = await db()
    .insert(cities)
    .values({ ...input, organizationId: org })
    .returning();
  await audit({ ...auditMeta(actor), action: "city.created", entityType: "city", entityId: c.id, after: c });
  return { id: c.id };
}

async function loadCity(actor: Actor, id: string) {
  const [c] = await db()
    .select()
    .from(cities)
    .where(and(eq(cities.id, id), eq(cities.organizationId, orgOf(actor)), isNull(cities.archivedAt)));
  if (!c) throw new AppError("not_found");
  return c;
}

export async function updateCity(actor: Actor, id: string, input: z.infer<typeof cityInput>) {
  requireOrgWide(actor, "cities.manage");
  const before = await loadCity(actor, id);
  const [dup] = await db()
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.organizationId, before.organizationId), eq(cities.code, input.code), ne(cities.id, id)));
  if (dup) throw new AppError("conflict", { field: "code" });
  const [after] = await db()
    .update(cities)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(cities.id, id))
    .returning();
  await audit({ ...auditMeta(actor), action: "city.updated", entityType: "city", entityId: id, before, after });
}

/** A city with active branches cannot be archived: move or archive its branches first. */
export async function archiveCity(actor: Actor, id: string) {
  requireOrgWide(actor, "cities.manage");
  const before = await loadCity(actor, id);
  const [inUse] = await db()
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.cityId, id), isNull(branches.archivedAt)))
    .limit(1);
  if (inUse) throw new AppError("conflict", { reason: "city_has_branches" });
  await db().update(cities).set({ archivedAt: new Date() }).where(eq(cities.id, id));
  await audit({ ...auditMeta(actor), action: "city.archived", entityType: "city", entityId: id, before });
}
