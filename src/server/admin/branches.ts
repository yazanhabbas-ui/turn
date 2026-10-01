import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { branches, cities, desks, floors, queues, visitReasons } from "@/db/schema";
import { branchesFor } from "@/domain/rbac/permissions";
import { localizedText, timezone, uuid, weekdays } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { allowedBranches, auditMeta, orgOf, requireCityAccess, requirePermission, type Actor } from "./actor";

export const branchInput = z.object({
  cityId: uuid,
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: localizedText({ max: 120 }),
  address: localizedText({ max: 300, required: false }).optional(),
  timezone,
  weekend: weekdays,
  isDefault: z.boolean().optional(),
});

export const floorInput = z.object({ name: localizedText({ max: 80 }), sortOrder: z.number().int().default(0) });

export const deskInput = z.object({
  number: z.string().trim().min(1).max(10),
  name: localizedText({ max: 80 }),
  floorId: uuid.nullable().optional(),
  zone: z.string().trim().max(20).nullable().optional(),
  sortOrder: z.number().int().default(0),
});

/** Branches visible to the actor for a permission (organization-wide grants see all). */
export async function visibleBranchIds(actor: Actor, permission: Parameters<typeof allowedBranches>[1]): Promise<string[]> {
  const scope = allowedBranches(actor, permission);
  const rows = await db()
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.organizationId, orgOf(actor)), isNull(branches.archivedAt)));
  const ids = rows.map((r) => r.id);
  return scope === "all" ? ids : ids.filter((id) => scope.includes(id));
}

export async function listBranches(actor: Actor) {
  const ids = await visibleBranchIds(actor, "admin.access");
  if (!ids.length) return [];
  const [rows, floorRows, deskRows] = await Promise.all([
    db().select().from(branches).where(inArray(branches.id, ids)).orderBy(asc(branches.createdAt)),
    db()
      .select()
      .from(floors)
      .where(and(inArray(floors.branchId, ids), isNull(floors.archivedAt)))
      .orderBy(asc(floors.sortOrder)),
    db()
      .select()
      .from(desks)
      .where(and(inArray(desks.branchId, ids), isNull(desks.archivedAt)))
      .orderBy(asc(desks.sortOrder), asc(desks.number)),
  ]);
  return rows.map((b) => ({
    ...b,
    floors: floorRows.filter((f) => f.branchId === b.id),
    desks: deskRows.filter((d) => d.branchId === b.id),
  }));
}

async function loadBranch(actor: Actor, id: string, tx: DbOrTx = db()) {
  const [b] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.organizationId, orgOf(actor)), isNull(branches.archivedAt)));
  if (!b) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", id);
  return b;
}

/** Every active reason gets a queue in every branch. Called when branches or reasons are created. */
export async function ensureQueues(tx: DbOrTx, organizationId: string) {
  const [bs, rs] = await Promise.all([
    tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.organizationId, organizationId), isNull(branches.archivedAt))),
    tx
      .select({ id: visitReasons.id })
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, organizationId), isNull(visitReasons.archivedAt))),
  ]);
  const values = bs.flatMap((b) => rs.map((r) => ({ organizationId, branchId: b.id, reasonId: r.id })));
  if (values.length) await tx.insert(queues).values(values).onConflictDoNothing();
}

async function clearOtherDefaults(tx: DbOrTx, organizationId: string, keepId: string) {
  await tx
    .update(branches)
    .set({ isDefault: false })
    .where(and(eq(branches.organizationId, organizationId), ne(branches.id, keepId)));
}

/** The city must exist in the organization and the actor must control it. */
async function assertCity(actor: Actor, cityId: string) {
  requireCityAccess(actor, "branches.manage", cityId);
  const [c] = await db()
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.id, cityId), eq(cities.organizationId, orgOf(actor)), isNull(cities.archivedAt)));
  if (!c) throw new AppError("validation", { field: "cityId" });
}

/** Only the organization-wide administrator decides which branch is the default one. */
const canSetDefault = (actor: Actor) => branchesFor(actor.auth.grants, "branches.manage") === "all";

export async function createBranch(actor: Actor, input: z.infer<typeof branchInput>) {
  await assertCity(actor, input.cityId);
  const org = orgOf(actor);
  return db().transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.organizationId, org), eq(branches.code, input.code)));
    if (dup) throw new AppError("conflict", { field: "code" });
    const [b] = await tx
      .insert(branches)
      .values({
        ...input,
        organizationId: org,
        address: input.address ?? null,
        isDefault: canSetDefault(actor) ? (input.isDefault ?? false) : false,
      })
      .returning();
    if (b.isDefault) await clearOtherDefaults(tx, org, b.id);
    await ensureQueues(tx, org);
    await audit(
      { ...auditMeta(actor), branchId: b.id, action: "branch.created", entityType: "branch", entityId: b.id, after: b },
      tx,
    );
    return { id: b.id };
  });
}

export async function updateBranch(actor: Actor, id: string, input: z.infer<typeof branchInput>) {
  const before = await loadBranch(actor, id);
  if (input.cityId !== before.cityId) await assertCity(actor, input.cityId);
  await db().transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.organizationId, before.organizationId), eq(branches.code, input.code), ne(branches.id, id)));
    if (dup) throw new AppError("conflict", { field: "code" });
    const [after] = await tx
      .update(branches)
      .set({
        ...input,
        address: input.address ?? null,
        isDefault: canSetDefault(actor) ? (input.isDefault ?? before.isDefault) : before.isDefault,
      })
      .where(eq(branches.id, id))
      .returning();
    if (after.isDefault) await clearOtherDefaults(tx, before.organizationId, id);
    await audit(
      { ...auditMeta(actor), branchId: id, action: "branch.updated", entityType: "branch", entityId: id, before, after },
      tx,
    );
  });
}

export async function archiveBranch(actor: Actor, id: string) {
  const before = await loadBranch(actor, id);
  const active = await db()
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.organizationId, before.organizationId), isNull(branches.archivedAt)));
  if (active.length <= 1) throw new AppError("conflict", { reason: "last_branch" });
  await db().transaction(async (tx) => {
    await tx.update(branches).set({ archivedAt: new Date(), isDefault: false }).where(eq(branches.id, id));
    await tx.update(queues).set({ isActive: false }).where(eq(queues.branchId, id));
    await audit({ ...auditMeta(actor), branchId: id, action: "branch.archived", entityType: "branch", entityId: id, before }, tx);
  });
}

export async function createFloor(actor: Actor, branchId: string, input: z.infer<typeof floorInput>) {
  const b = await loadBranch(actor, branchId);
  const [f] = await db()
    .insert(floors)
    .values({ ...input, organizationId: b.organizationId, branchId })
    .returning();
  await audit({ ...auditMeta(actor), branchId, action: "floor.created", entityType: "floor", entityId: f.id, after: f });
  return { id: f.id };
}

async function loadFloor(actor: Actor, id: string) {
  const [f] = await db()
    .select()
    .from(floors)
    .where(and(eq(floors.id, id), eq(floors.organizationId, orgOf(actor)), isNull(floors.archivedAt)));
  if (!f) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", f.branchId);
  return f;
}

export async function updateFloor(actor: Actor, id: string, input: z.infer<typeof floorInput>) {
  const before = await loadFloor(actor, id);
  const [after] = await db().update(floors).set(input).where(eq(floors.id, id)).returning();
  await audit({
    ...auditMeta(actor),
    branchId: before.branchId,
    action: "floor.updated",
    entityType: "floor",
    entityId: id,
    before,
    after,
  });
}

export async function archiveFloor(actor: Actor, id: string) {
  const before = await loadFloor(actor, id);
  await db().transaction(async (tx) => {
    await tx.update(floors).set({ archivedAt: new Date() }).where(eq(floors.id, id));
    await tx.update(desks).set({ floorId: null }).where(eq(desks.floorId, id));
    await audit(
      { ...auditMeta(actor), branchId: before.branchId, action: "floor.archived", entityType: "floor", entityId: id, before },
      tx,
    );
  });
}

/** A desk's floor must be a live floor of the desk's own branch (never one from another branch or organization). */
async function assertFloorInBranch(tx: DbOrTx, branchId: string, floorId: string | null | undefined) {
  if (!floorId) return;
  const [f] = await tx
    .select({ id: floors.id })
    .from(floors)
    .where(and(eq(floors.id, floorId), eq(floors.branchId, branchId), isNull(floors.archivedAt)));
  if (!f) throw new AppError("validation", { field: "floorId" });
}

async function assertDeskNumberFree(tx: DbOrTx, branchId: string, number: string, exceptId?: string) {
  const rows = await tx
    .select({ id: desks.id })
    .from(desks)
    .where(and(eq(desks.branchId, branchId), eq(desks.number, number), isNull(desks.archivedAt)));
  if (rows.some((r) => r.id !== exceptId)) throw new AppError("conflict", { field: "number" });
}

export async function createDesk(actor: Actor, branchId: string, input: z.infer<typeof deskInput>) {
  const b = await loadBranch(actor, branchId);
  return db().transaction(async (tx) => {
    await assertFloorInBranch(tx, branchId, input.floorId);
    await assertDeskNumberFree(tx, branchId, input.number);
    // An archived desk may hold the same number; free it so the unique index allows reuse.
    await tx
      .update(desks)
      .set({ number: `${input.number}~${Date.now()}` })
      .where(and(eq(desks.branchId, branchId), eq(desks.number, input.number)));
    const [d] = await tx
      .insert(desks)
      .values({ ...input, floorId: input.floorId ?? null, zone: input.zone ?? null, organizationId: b.organizationId, branchId })
      .returning();
    await audit({ ...auditMeta(actor), branchId, action: "desk.created", entityType: "desk", entityId: d.id, after: d }, tx);
    return { id: d.id };
  });
}

async function loadDesk(actor: Actor, id: string) {
  const [d] = await db()
    .select()
    .from(desks)
    .where(and(eq(desks.id, id), eq(desks.organizationId, orgOf(actor)), isNull(desks.archivedAt)));
  if (!d) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", d.branchId);
  return d;
}

export async function updateDesk(actor: Actor, id: string, input: z.infer<typeof deskInput>) {
  const before = await loadDesk(actor, id);
  await db().transaction(async (tx) => {
    await assertFloorInBranch(tx, before.branchId, input.floorId);
    await assertDeskNumberFree(tx, before.branchId, input.number, id);
    const [after] = await tx
      .update(desks)
      .set({ ...input, floorId: input.floorId ?? null, zone: input.zone ?? null })
      .where(eq(desks.id, id))
      .returning();
    await audit(
      { ...auditMeta(actor), branchId: before.branchId, action: "desk.updated", entityType: "desk", entityId: id, before, after },
      tx,
    );
  });
}

export async function archiveDesk(actor: Actor, id: string) {
  const before = await loadDesk(actor, id);
  await db().transaction(async (tx) => {
    await tx.update(desks).set({ archivedAt: new Date() }).where(eq(desks.id, id));
    await audit(
      { ...auditMeta(actor), branchId: before.branchId, action: "desk.archived", entityType: "desk", entityId: id, before },
      tx,
    );
  });
}
