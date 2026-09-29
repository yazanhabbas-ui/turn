import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, reportSchedules } from "@/db/schema";
import { zonedParts, zonedToUtc } from "@/domain/schedule/time";
import { pickText } from "@/i18n/locales";
import { now as clockNow } from "../clock";
import { logger } from "../logger";
import { sendTemplated } from "../messaging/service";
import { buildExport, type ExportFormat } from "./export";
import { exportWords, type ExportLocale } from "./export-doc";
import { buildScheduledReport } from "./service";

export type ScheduleRow = typeof reportSchedules.$inferSelect;

const FIVE_MINUTES = 5 * 60_000;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Time zone of a schedule: its branch, or the organization's first branch (the zone the org-wide report uses). */
export async function timezoneOf(s: Pick<ScheduleRow, "organizationId" | "branchId">): Promise<string> {
  const rows = await db()
    .select({ id: branches.id, timezone: branches.timezone })
    .from(branches)
    .where(and(eq(branches.organizationId, s.organizationId), isNull(branches.archivedAt)))
    .orderBy(asc(branches.createdAt));
  return (s.branchId ? rows.find((b) => b.id === s.branchId) : rows[0])?.timezone ?? "UTC";
}

/**
 * The data period of a scheduled report as of `now`: yesterday for a daily schedule, the seven days ending yesterday
 * for a weekly one (dates in the schedule's time zone).
 */
export function periodFor(frequency: string, now: number, timezone: string): { from: string; to: string } {
  const yesterday = addDays(zonedParts(now, timezone).date, -1);
  return { from: frequency === "weekly" ? addDays(yesterday, -6) : yesterday, to: yesterday };
}

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** The most recent moment (UTC ms) at or before `now` when the schedule should have fired. */
export function lastSlot(s: Pick<ScheduleRow, "frequency" | "weekday" | "sendHour">, now: number, timezone: string): number {
  const today = zonedParts(now, timezone);
  if (s.frequency === "weekly") {
    let date = addDays(today.date, -((today.weekday - (s.weekday ?? 0) + 7) % 7));
    let slot = zonedToUtc(date, hhmm(s.sendHour), timezone);
    if (slot > now) {
      date = addDays(date, -7);
      slot = zonedToUtc(date, hhmm(s.sendHour), timezone);
    }
    return slot;
  }
  const slot = zonedToUtc(today.date, hhmm(s.sendHour), timezone);
  return slot <= now ? slot : zonedToUtc(addDays(today.date, -1), hhmm(s.sendHour), timezone);
}

/**
 * Due when the latest slot has passed, the schedule already existed at that slot and it has not run since.
 * Missing a slot (server down) is caught up on the next pass, once, for the current period.
 */
export function isDue(s: ScheduleRow, now: number, timezone: string): { due: boolean; slot: number } {
  const slot = lastSlot(s, now, timezone);
  const due = s.isActive && slot > s.createdAt.getTime() && (!s.lastRunAt || s.lastRunAt.getTime() < slot);
  return { due, slot };
}

export type DeliveryResult = {
  sent: number;
  failed: number;
  skipped: number;
  filename: string;
  period: { from: string; to: string };
};

/** Builds the export for the schedule's period and emails it to every recipient. Never touches `lastRunAt`. */
export async function deliverSchedule(s: ScheduleRow, now = clockNow()): Promise<DeliveryResult> {
  const tz = await timezoneOf(s);
  const period = periodFor(s.frequency, now, tz);
  const filters = s.filters as { reasonId?: string };
  const report = await buildScheduledReport(s.organizationId, {
    ...period,
    branchId: s.branchId ?? undefined,
    reasonId: filters.reasonId,
  });
  const locale: ExportLocale = s.locale === "en" ? "en" : "ar";
  const file = await buildExport(report, s.format as ExportFormat, locale);
  const words = exportWords(locale);
  const [branchRow] = s.branchId
    ? await db().select({ name: branches.name }).from(branches).where(eq(branches.id, s.branchId))
    : [];
  const vars = {
    name: s.name,
    period: words.period(period.from, period.to),
    branch: s.branchId ? pickText(branchRow?.name, locale, "—") : words.all,
  };
  const result: DeliveryResult = { sent: 0, failed: 0, skipped: 0, filename: file.filename, period };
  for (const to of s.recipients) {
    const r = await sendTemplated({
      organizationId: s.organizationId,
      branchId: s.branchId,
      channel: "email",
      event: "report_scheduled",
      to,
      locale,
      vars,
      attachments: [{ filename: file.filename, contentType: file.contentType, content: file.body }],
    });
    result[r.status]++;
  }
  return result;
}

/** Runs one schedule: claims the period first (safe with several app nodes), then delivers. */
async function runSchedule(s: ScheduleRow, slot: number, now: number) {
  const claimed = await db()
    .update(reportSchedules)
    .set({ lastRunAt: new Date(now) })
    .where(
      and(
        eq(reportSchedules.id, s.id),
        sql`(${reportSchedules.lastRunAt} is null or ${reportSchedules.lastRunAt} < ${new Date(slot)})`,
      ),
    )
    .returning({ id: reportSchedules.id });
  if (!claimed.length) return null;
  try {
    const result = await deliverSchedule(s, now);
    const problem = result.failed || result.skipped ? `failed:${result.failed} skipped:${result.skipped}` : null;
    await db().update(reportSchedules).set({ lastError: problem }).where(eq(reportSchedules.id, s.id));
    return result;
  } catch (err) {
    logger.error({ err, scheduleId: s.id }, "scheduled report failed");
    await db()
      .update(reportSchedules)
      .set({ lastError: (err instanceof Error ? err.message : "failed").slice(0, 300) })
      .where(eq(reportSchedules.id, s.id));
    return null;
  }
}

/** One pass over the active schedules. Returns the ids that were sent. */
export async function runDueSchedules(now = clockNow()): Promise<string[]> {
  const active = await db().select().from(reportSchedules).where(eq(reportSchedules.isActive, true));
  const zones = new Map<string, string>();
  const ran: string[] = [];
  for (const s of active) {
    try {
      const key = `${s.organizationId}:${s.branchId ?? ""}`;
      if (!zones.has(key)) zones.set(key, await timezoneOf(s));
      const { due, slot } = isDue(s, now, zones.get(key)!);
      if (!due) continue;
      if (await runSchedule(s, slot, now)) ran.push(s.id);
    } catch (err) {
      logger.error({ err, scheduleId: s.id }, "report schedule pass failed");
    }
  }
  return ran;
}

const g = globalThis as unknown as {
  __dorReportTimer?: NodeJS.Timeout;
  __dorReportFirst?: NodeJS.Timeout;
  __dorReportRunning?: boolean;
};

async function pass() {
  if (g.__dorReportRunning) return;
  g.__dorReportRunning = true;
  try {
    await runDueSchedules();
  } catch (err) {
    logger.error({ err }, "report scheduler pass failed");
  } finally {
    g.__dorReportRunning = false;
  }
}

/** Checks every 5 minutes. State lives in `last_run_at`, so restarts neither lose nor repeat a report. */
export function startReportScheduler() {
  if (g.__dorReportTimer) return;
  g.__dorReportTimer = setInterval(() => void pass(), FIVE_MINUTES);
  g.__dorReportTimer.unref();
  g.__dorReportFirst = setTimeout(() => void pass(), 20_000);
  g.__dorReportFirst.unref();
}

export function stopReportScheduler() {
  if (g.__dorReportTimer) clearInterval(g.__dorReportTimer);
  if (g.__dorReportFirst) clearTimeout(g.__dorReportFirst);
  g.__dorReportTimer = undefined;
  g.__dorReportFirst = undefined;
}
