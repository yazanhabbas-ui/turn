import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentGroups, queues, reasonAssignments, schedules, users, visitReasons } from "@/db/schema";
import { hexColor, localizedText, ticketPrefix, uuid } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { ensureQueues } from "./branches";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

/** Built-in intake field keys; custom keys carry their own label. */
export const BUILTIN_INTAKE_FIELDS = ["name", "phone", "company", "national_id_last4", "email", "notes"] as const;

const intakeField = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: localizedText({ max: 80, required: false }).optional(),
  type: z.enum(["text", "phone", "number", "email"]).optional(),
  required: z.boolean(),
});

export const reasonInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/),
  name: localizedText({ max: 120 }),
  description: localizedText({ max: 400, required: false }).optional(),
  icon: z.string().trim().min(1).max(60),
  color: hexColor,
  prefix: ticketPrefix,
  defaultPriorityKey: z.string().max(40).nullable().optional(),
  expectedServiceMinutes: z.number().int().min(1).max(480),
  slaTargetWaitMinutes: z.number().int().min(1).max(480),
  intakeFields: z
    .array(intakeField)
    .max(12)
    .refine((f) => new Set(f.map((x) => x.key)).size === f.length, { message: "duplicate_key" }),
  allowAppointments: z.boolean(),
  scheduleId: uuid.nullable().optional(),
  cutoffMinutes: z.number().int().min(0).max(480),
  isFeatured: z.boolean(),
  shortcutKey: z.string().trim().max(1).nullable().optional(),
  sortOrder: z.number().int().default(0),
});

export const assignmentsInput = z.array(
  z
    .object({
      userId: uuid.nullable().optional(),
      groupId: uuid.nullable().optional(),
      branchId: uuid.nullable().optional(),
      proficiency: z.number().int().min(1).max(5),
      isPrimary: z.boolean(),
    })
    .refine((a) => !!a.userId !== !!a.groupId, { message: "user_xor_group" }),
);

export async function listReasons(actor: Actor, opts: { includeArchived?: boolean } = {}) {
  requirePermission(actor, "reasons.view");
  const org = orgOf(actor);
  const rows = await db()
    .select()
    .from(visitReasons)
    .where(and(eq(visitReasons.organizationId, org), opts.includeArchived ? undefined : isNull(visitReasons.archivedAt)))
    .orderBy(asc(visitReasons.sortOrder), asc(visitReasons.createdAt));
  const ids = rows.map((r) => r.id);
  const assignments = ids.length
    ? await db().select().from(reasonAssignments).where(inArray(reasonAssignments.reasonId, ids))
    : [];
  return rows.map((r) => ({ ...r, assignments: assignments.filter((a) => a.reasonId === r.id) }));
}

async function loadReason(actor: Actor, id: string) {
  const [r] = await db()
    .select()
    .from(visitReasons)
    .where(and(eq(visitReasons.id, id), eq(visitReasons.organizationId, orgOf(actor))));
  if (!r) throw new AppError("not_found");
  return r;
}

async function validateRefs(actor: Actor, input: z.infer<typeof reasonInput>, exceptId?: string) {
  const org = orgOf(actor);
  const [dup] = await db()
    .select({ id: visitReasons.id })
    .from(visitReasons)
    .where(
      and(
        eq(visitReasons.organizationId, org),
        eq(visitReasons.code, input.code),
        exceptId ? ne(visitReasons.id, exceptId) : undefined,
      ),
    );
  if (dup) throw new AppError("conflict", { field: "code" });
  if (input.shortcutKey) {
    const [clash] = await db()
      .select({ id: visitReasons.id })
      .from(visitReasons)
      .where(
        and(
          eq(visitReasons.organizationId, org),
          eq(visitReasons.shortcutKey, input.shortcutKey),
          isNull(visitReasons.archivedAt),
          exceptId ? ne(visitReasons.id, exceptId) : undefined,
        ),
      );
    if (clash) throw new AppError("conflict", { field: "shortcutKey" });
  }
  if (input.scheduleId) {
    const [s] = await db()
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.id, input.scheduleId), eq(schedules.organizationId, org)));
    if (!s) throw new AppError("validation", { field: "scheduleId" });
  }
}

function values(input: z.infer<typeof reasonInput>) {
  return {
    ...input,
    description: input.description ?? null,
    defaultPriorityKey: input.defaultPriorityKey ?? null,
    scheduleId: input.scheduleId ?? null,
    shortcutKey: input.shortcutKey || null,
  };
}

export async function createReason(actor: Actor, input: z.infer<typeof reasonInput>) {
  requireOrgWide(actor, "reasons.manage");
  await validateRefs(actor, input);
  return db().transaction(async (tx) => {
    const [r] = await tx
      .insert(visitReasons)
      .values({ ...values(input), organizationId: orgOf(actor) })
      .returning();
    await ensureQueues(tx, orgOf(actor));
    await audit({ ...auditMeta(actor), action: "reason.created", entityType: "visit_reason", entityId: r.id, after: r }, tx);
    return { id: r.id };
  });
}

export async function updateReason(actor: Actor, id: string, input: z.infer<typeof reasonInput>) {
  requireOrgWide(actor, "reasons.manage");
  const before = await loadReason(actor, id);
  await validateRefs(actor, input, id);
  await db().transaction(async (tx) => {
    const [after] = await tx.update(visitReasons).set(values(input)).where(eq(visitReasons.id, id)).returning();
    await audit({ ...auditMeta(actor), action: "reason.updated", entityType: "visit_reason", entityId: id, before, after }, tx);
  });
}

/** Reasons are archived, never deleted: tickets and reports keep referencing them. */
export async function setReasonArchived(actor: Actor, id: string, archived: boolean) {
  requireOrgWide(actor, "reasons.manage");
  const before = await loadReason(actor, id);
  await db().transaction(async (tx) => {
    if (!archived && before.shortcutKey) {
      const [clash] = await tx
        .select({ id: visitReasons.id })
        .from(visitReasons)
        .where(
          and(
            eq(visitReasons.organizationId, before.organizationId),
            eq(visitReasons.shortcutKey, before.shortcutKey),
            isNull(visitReasons.archivedAt),
          ),
        );
      if (clash) await tx.update(visitReasons).set({ shortcutKey: null }).where(eq(visitReasons.id, id));
    }
    await tx
      .update(visitReasons)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(visitReasons.id, id));
    await tx.update(queues).set({ isActive: !archived }).where(eq(queues.reasonId, id));
    if (!archived) await ensureQueues(tx, before.organizationId);
    await audit(
      { ...auditMeta(actor), action: archived ? "reason.archived" : "reason.restored", entityType: "visit_reason", entityId: id },
      tx,
    );
  });
}

/** Replaces the list of agents / groups who can serve this reason. */
export async function setAssignments(actor: Actor, reasonId: string, input: z.infer<typeof assignmentsInput>) {
  requirePermission(actor, "reasons.manage");
  await loadReason(actor, reasonId);
  const org = orgOf(actor);
  const userIds = input.map((a) => a.userId).filter((x): x is string => !!x);
  const groupIds = input.map((a) => a.groupId).filter((x): x is string => !!x);
  if (userIds.length) {
    const found = await db()
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.organizationId, org)));
    if (found.length !== new Set(userIds).size) throw new AppError("validation", { field: "userId" });
  }
  if (groupIds.length) {
    const found = await db()
      .select({ id: agentGroups.id })
      .from(agentGroups)
      .where(and(inArray(agentGroups.id, groupIds), eq(agentGroups.organizationId, org)));
    if (found.length !== new Set(groupIds).size) throw new AppError("validation", { field: "groupId" });
  }
  const keys = input.map((a) => `${a.userId ?? ""}:${a.groupId ?? ""}:${a.branchId ?? ""}`);
  if (new Set(keys).size !== keys.length) throw new AppError("validation", { reason: "duplicate_assignment" });
  for (const a of input) if (a.branchId) requirePermission(actor, "reasons.manage", a.branchId);

  await db().transaction(async (tx) => {
    const before = await tx.select().from(reasonAssignments).where(eq(reasonAssignments.reasonId, reasonId));
    await tx.delete(reasonAssignments).where(eq(reasonAssignments.reasonId, reasonId));
    if (input.length) {
      await tx.insert(reasonAssignments).values(
        input.map((a) => ({
          reasonId,
          userId: a.userId ?? null,
          groupId: a.groupId ?? null,
          branchId: a.branchId ?? null,
          proficiency: a.proficiency,
          isPrimary: a.isPrimary,
        })),
      );
    }
    await audit(
      {
        ...auditMeta(actor),
        action: "reason.assignments_updated",
        entityType: "visit_reason",
        entityId: reasonId,
        before,
        after: input,
      },
      tx,
    );
  });
}
