import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { agentProfiles, branches, floors, hallReasons, hallSessions, halls, visitReasons } from "@/db/schema";
import { localizedText, uuid } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requirePermission, type Actor } from "../admin/actor";

export const hallInput = z.object({
  /** What the display and the voice announce ("hall 2"). */
  number: z.string().trim().min(1).max(10),
  name: localizedText({ max: 80 }),
  /** How many visitors fit. A hall of one is a desk, so at least 2. */
  capacity: z.number().int().min(2).max(500),
  floorId: uuid.nullable().optional(),
  zone: z.string().trim().max(20).nullable().optional(),
  /** Reasons delivered in halls that this hall accepts; empty = all of them. */
  reasonIds: z.array(uuid).max(200).default([]),
  sortOrder: z.number().int().default(0),
});
export type HallInput = z.infer<typeof hallInput>;

async function loadBranch(actor: Actor, id: string, tx: DbOrTx = db()) {
  const [b] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.organizationId, orgOf(actor)), isNull(branches.archivedAt)));
  if (!b) throw new AppError("not_found");
  requirePermission(actor, "halls.manage", id);
  return b;
}

async function loadHall(actor: Actor, id: string, tx: DbOrTx = db()) {
  const [h] = await tx
    .select()
    .from(halls)
    .where(and(eq(halls.id, id), eq(halls.organizationId, orgOf(actor)), isNull(halls.archivedAt)));
  if (!h) throw new AppError("not_found");
  requirePermission(actor, "halls.manage", h.branchId);
  return h;
}

async function validateRefs(tx: DbOrTx, organizationId: string, branchId: string, input: HallInput, exceptId?: string) {
  if (input.floorId) {
    const [f] = await tx
      .select({ id: floors.id })
      .from(floors)
      .where(and(eq(floors.id, input.floorId), eq(floors.branchId, branchId), isNull(floors.archivedAt)));
    if (!f) throw new AppError("validation", { field: "floorId" });
  }
  const taken = await tx
    .select({ id: halls.id })
    .from(halls)
    .where(
      and(
        eq(halls.branchId, branchId),
        eq(halls.number, input.number),
        isNull(halls.archivedAt),
        exceptId ? ne(halls.id, exceptId) : undefined,
      ),
    );
  if (taken.length) throw new AppError("conflict", { field: "number" });
  if (input.reasonIds.length) {
    const found = await tx
      .select({ id: visitReasons.id })
      .from(visitReasons)
      .where(
        and(
          inArray(visitReasons.id, input.reasonIds),
          eq(visitReasons.organizationId, organizationId),
          eq(visitReasons.delivery, "hall"),
          isNull(visitReasons.archivedAt),
        ),
      );
    if (found.length !== new Set(input.reasonIds).size) throw new AppError("validation", { field: "reasonIds" });
  }
}

async function writeReasons(tx: DbOrTx, hallId: string, reasonIds: string[]) {
  await tx.delete(hallReasons).where(eq(hallReasons.hallId, hallId));
  const unique = [...new Set(reasonIds)];
  if (unique.length) await tx.insert(hallReasons).values(unique.map((reasonId) => ({ hallId, reasonId })));
}

/** The halls of the branches the actor may manage, with the reasons each accepts. */
export async function listHalls(actor: Actor, branchIds: string[]) {
  if (!branchIds.length) return [];
  const rows = await db()
    .select()
    .from(halls)
    .where(and(inArray(halls.branchId, branchIds), isNull(halls.archivedAt)))
    .orderBy(asc(halls.sortOrder), asc(halls.number));
  const links = rows.length
    ? await db()
        .select()
        .from(hallReasons)
        .where(
          inArray(
            hallReasons.hallId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((h) => ({ ...h, reasonIds: links.filter((l) => l.hallId === h.id).map((l) => l.reasonId) }));
}

export async function createHall(actor: Actor, branchId: string, input: HallInput) {
  const b = await loadBranch(actor, branchId);
  return db().transaction(async (tx) => {
    await validateRefs(tx, b.organizationId, branchId, input);
    const { reasonIds, ...rest } = input;
    const [h] = await tx
      .insert(halls)
      .values({ ...rest, floorId: input.floorId ?? null, zone: input.zone ?? null, organizationId: b.organizationId, branchId })
      .returning();
    await writeReasons(tx, h.id, reasonIds);
    await audit(
      { ...auditMeta(actor), branchId, action: "hall.created", entityType: "hall", entityId: h.id, after: { ...h, reasonIds } },
      tx,
    );
    return { id: h.id };
  });
}

export async function updateHall(actor: Actor, id: string, input: HallInput) {
  const before = await loadHall(actor, id);
  await db().transaction(async (tx) => {
    await validateRefs(tx, before.organizationId, before.branchId, input, id);
    // A live session keeps the capacity it opened with; shrinking the room below the people inside is refused.
    const [live] = await tx
      .select({ capacity: hallSessions.capacity })
      .from(hallSessions)
      .where(and(eq(hallSessions.hallId, id), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
    if (live && input.capacity < live.capacity)
      throw new AppError("conflict", { reason: "hall_session_open", field: "capacity" });
    const { reasonIds, ...rest } = input;
    const [after] = await tx
      .update(halls)
      .set({ ...rest, floorId: input.floorId ?? null, zone: input.zone ?? null })
      .where(eq(halls.id, id))
      .returning();
    await writeReasons(tx, id, reasonIds);
    await audit(
      {
        ...auditMeta(actor),
        branchId: before.branchId,
        action: "hall.updated",
        entityType: "hall",
        entityId: id,
        before,
        after: { ...after, reasonIds },
      },
      tx,
    );
  });
}

export async function archiveHall(actor: Actor, id: string) {
  const before = await loadHall(actor, id);
  await db().transaction(async (tx) => {
    const [live] = await tx
      .select({ id: hallSessions.id })
      .from(hallSessions)
      .where(and(eq(hallSessions.hallId, id), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
    if (live) throw new AppError("conflict", { reason: "hall_session_open" });
    await tx.update(halls).set({ archivedAt: new Date() }).where(eq(halls.id, id));
    // Hosts lose the hall; they pick another next time they sign in.
    await tx.update(agentProfiles).set({ currentHallId: null }).where(eq(agentProfiles.currentHallId, id));
    await tx.update(agentProfiles).set({ defaultHallId: null }).where(eq(agentProfiles.defaultHallId, id));
    await audit(
      { ...auditMeta(actor), branchId: before.branchId, action: "hall.archived", entityType: "hall", entityId: id, before },
      tx,
    );
  });
}
