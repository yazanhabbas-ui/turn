import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, reportSchedules, visitReasons } from "@/db/schema";
import { EXPORT_SECTIONS, normalizeSections } from "@/domain/reports/sections";
import { uuid } from "@/domain/validation";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { AppError } from "../http/errors";
import { deliverSchedule, type DeliveryResult } from "../reports/scheduler";
import { allowedBranches, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const MAX_RECIPIENTS = 20;

export const reportScheduleInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    frequency: z.enum(["daily", "weekly"]),
    /** Weekly only: 0 = Sunday. */
    weekday: z.number().int().min(0).max(6).nullish(),
    sendHour: z.number().int().min(0).max(23).default(7),
    format: z.enum(["pdf", "xlsx", "csv"]),
    locale: z.enum(["ar", "en"]),
    /** Empty = all branches (needs an organization-wide grant). */
    branchId: uuid.nullish(),
    reasonId: uuid.nullish(),
    recipients: z
      .array(
        z
          .email()
          .max(200)
          .transform((v) => v.toLowerCase()),
      )
      .min(1)
      .max(MAX_RECIPIENTS),
    /** Sections to include; empty/absent = the full report. */
    sections: z.array(z.enum(EXPORT_SECTIONS)).max(EXPORT_SECTIONS.length).nullish(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.frequency !== "weekly" || (v.weekday !== null && v.weekday !== undefined), {
    path: ["weekday"],
    message: "weekday_required",
  });
export type ReportScheduleInput = z.infer<typeof reportScheduleInput>;

type Row = typeof reportSchedules.$inferSelect;

function present(r: Row) {
  return {
    id: r.id,
    name: r.name,
    frequency: r.frequency as "daily" | "weekly",
    weekday: r.weekday,
    sendHour: r.sendHour,
    format: r.format as "pdf" | "xlsx" | "csv",
    locale: r.locale as "ar" | "en",
    branchId: r.branchId,
    reasonId: (r.filters as { reasonId?: string }).reasonId ?? null,
    recipients: r.recipients,
    sections: r.sections,
    isActive: r.isActive,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastError: r.lastError,
  };
}

/** A schedule covers one branch, or every branch when `branchId` is null. Both need `reports.schedule` for that scope. */
function requireScope(actor: Actor, branchId: string | null) {
  if (branchId) requirePermission(actor, "reports.schedule", branchId);
  else requireOrgWide(actor, "reports.schedule");
}

async function load(actor: Actor, id: string) {
  requirePermission(actor, "reports.schedule");
  const [row] = await db()
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, orgOf(actor))));
  if (!row) throw new AppError("not_found");
  requireScope(actor, row.branchId);
  return row;
}

async function validateTargets(actor: Actor, input: ReportScheduleInput) {
  const org = orgOf(actor);
  if (input.branchId) {
    const [b] = await db()
      .select({ o: branches.organizationId, a: branches.archivedAt })
      .from(branches)
      .where(eq(branches.id, input.branchId));
    if (!b || b.o !== org || b.a) throw new AppError("validation", { field: "branchId" });
  }
  if (input.reasonId) {
    const [r] = await db()
      .select({ o: visitReasons.organizationId })
      .from(visitReasons)
      .where(eq(visitReasons.id, input.reasonId));
    if (!r || r.o !== org) throw new AppError("validation", { field: "reasonId" });
  }
}

const values = (input: ReportScheduleInput) => ({
  name: input.name,
  frequency: input.frequency,
  weekday: input.frequency === "weekly" ? (input.weekday ?? 0) : null,
  sendHour: input.sendHour,
  format: input.format,
  locale: input.locale,
  branchId: input.branchId ?? null,
  filters: input.reasonId ? { reasonId: input.reasonId } : {},
  recipients: [...new Set(input.recipients)],
  sections: input.sections?.length ? normalizeSections(input.sections) : null,
  isActive: input.isActive,
});

export async function listReportSchedules(actor: Actor) {
  requirePermission(actor, "reports.schedule");
  const allowed = allowedBranches(actor, "reports.schedule");
  const rows = await db()
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.organizationId, orgOf(actor)))
    .orderBy(asc(reportSchedules.createdAt));
  return rows.filter((r) => allowed === "all" || (r.branchId !== null && allowed.includes(r.branchId))).map(present);
}

/** What the schedule form can pick: branches within the actor's scope (and whether "all branches" is allowed) and reasons. */
export async function reportScheduleOptions(actor: Actor) {
  requirePermission(actor, "reports.schedule");
  const allowed = allowedBranches(actor, "reports.schedule");
  const org = orgOf(actor);
  const [bs, reasons] = await Promise.all([
    db()
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.organizationId, org), isNull(branches.archivedAt)))
      .orderBy(asc(branches.createdAt)),
    db()
      .select({ id: visitReasons.id, name: visitReasons.name })
      .from(visitReasons)
      .where(eq(visitReasons.organizationId, org))
      .orderBy(asc(visitReasons.sortOrder)),
  ]);
  return {
    orgWide: allowed === "all",
    branches: bs.filter((b) => allowed === "all" || allowed.includes(b.id)),
    reasons,
  };
}

export async function createReportSchedule(actor: Actor, input: ReportScheduleInput) {
  requireScope(actor, input.branchId ?? null);
  await validateTargets(actor, input);
  const [row] = await db()
    .insert(reportSchedules)
    .values({
      ...values(input),
      organizationId: orgOf(actor),
      createdByUserId: actor.auth.user.id,
      // On the server clock, so a schedule never fires for a slot that passed before it existed.
      createdAt: new Date(clockNow()),
    })
    .returning();
  await audit({
    ...auditMeta(actor),
    branchId: row.branchId,
    action: "report_schedule.created",
    entityType: "report_schedule",
    entityId: row.id,
    after: present(row),
  });
  return present(row);
}

export async function updateReportSchedule(actor: Actor, id: string, input: ReportScheduleInput) {
  const before = await load(actor, id);
  requireScope(actor, input.branchId ?? null);
  await validateTargets(actor, input);
  const [row] = await db()
    .update(reportSchedules)
    .set({ ...values(input), updatedAt: new Date(clockNow()) })
    .where(eq(reportSchedules.id, id))
    .returning();
  await audit({
    ...auditMeta(actor),
    branchId: row.branchId,
    action: "report_schedule.updated",
    entityType: "report_schedule",
    entityId: id,
    before: present(before),
    after: present(row),
  });
  return present(row);
}

export async function deleteReportSchedule(actor: Actor, id: string) {
  const before = await load(actor, id);
  await db().delete(reportSchedules).where(eq(reportSchedules.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: before.branchId,
    action: "report_schedule.deleted",
    entityType: "report_schedule",
    entityId: id,
    before: present(before),
  });
}

/** Sends the schedule's report for its usual period to the recipients now (the "test" button). Does not move `lastRunAt`. */
export async function sendReportScheduleNow(actor: Actor, id: string): Promise<DeliveryResult> {
  const row = await load(actor, id);
  const result = await deliverSchedule(row, clockNow());
  await audit({
    ...auditMeta(actor),
    branchId: row.branchId,
    action: "report_schedule.sent_now",
    entityType: "report_schedule",
    entityId: id,
    after: { sent: result.sent, failed: result.failed, skipped: result.skipped, period: result.period },
  });
  return result;
}
