import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentGroupMembers, agentGroups, users } from "@/db/schema";
import { localizedText, uuid } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { auditMeta, orgOf, requirePermission, type Actor } from "./actor";

export const groupInput = z.object({
  name: localizedText({ max: 80 }),
  branchId: uuid.nullable().optional(),
  supervisorUserId: uuid.nullable().optional(),
  memberIds: z.array(uuid).max(500),
});

export async function listGroups(actor: Actor) {
  requirePermission(actor, "reasons.view");
  const rows = await db()
    .select()
    .from(agentGroups)
    .where(and(eq(agentGroups.organizationId, orgOf(actor)), isNull(agentGroups.archivedAt)))
    .orderBy(asc(agentGroups.createdAt));
  const ids = rows.map((g) => g.id);
  const members = ids.length ? await db().select().from(agentGroupMembers).where(inArray(agentGroupMembers.groupId, ids)) : [];
  return rows.map((g) => ({ ...g, memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId) }));
}

async function assertUsers(actor: Actor, ids: string[]) {
  if (!ids.length) return;
  const found = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.organizationId, orgOf(actor))));
  if (found.length !== new Set(ids).size) throw new AppError("validation", { field: "memberIds" });
}

export async function saveGroup(actor: Actor, id: string | null, input: z.infer<typeof groupInput>) {
  requirePermission(actor, "reasons.manage", input.branchId ?? undefined);
  await assertUsers(actor, [...input.memberIds, ...(input.supervisorUserId ? [input.supervisorUserId] : [])]);
  return db().transaction(async (tx) => {
    const values = { name: input.name, branchId: input.branchId ?? null, supervisorUserId: input.supervisorUserId ?? null };
    let groupId = id;
    let before: unknown = null;
    if (id) {
      const [g] = await tx
        .select()
        .from(agentGroups)
        .where(and(eq(agentGroups.id, id), eq(agentGroups.organizationId, orgOf(actor)), isNull(agentGroups.archivedAt)));
      if (!g) throw new AppError("not_found");
      before = g;
      await tx.update(agentGroups).set(values).where(eq(agentGroups.id, id));
      await tx.delete(agentGroupMembers).where(eq(agentGroupMembers.groupId, id));
    } else {
      const [g] = await tx
        .insert(agentGroups)
        .values({ ...values, organizationId: orgOf(actor) })
        .returning();
      groupId = g.id;
    }
    const memberIds = [...new Set(input.memberIds)];
    if (memberIds.length) await tx.insert(agentGroupMembers).values(memberIds.map((userId) => ({ groupId: groupId!, userId })));
    await audit(
      {
        ...auditMeta(actor),
        action: id ? "group.updated" : "group.created",
        entityType: "agent_group",
        entityId: groupId,
        before,
        after: input,
      },
      tx,
    );
    return { id: groupId! };
  });
}

export async function archiveGroup(actor: Actor, id: string) {
  requirePermission(actor, "reasons.manage");
  const [g] = await db()
    .select()
    .from(agentGroups)
    .where(and(eq(agentGroups.id, id), eq(agentGroups.organizationId, orgOf(actor))));
  if (!g) throw new AppError("not_found");
  await db().update(agentGroups).set({ archivedAt: new Date() }).where(eq(agentGroups.id, id));
  await audit({ ...auditMeta(actor), action: "group.archived", entityType: "agent_group", entityId: id, before: g });
}
