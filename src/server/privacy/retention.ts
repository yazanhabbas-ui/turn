import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, organizations } from "@/db/schema";
import {
  auditCutoffs,
  cutoff,
  emptyCounts,
  SECURITY_ACTION_PREFIXES,
  type RetentionCounts,
  type RetentionSummary,
} from "@/domain/privacy/retention";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { logger } from "../logger";
import { getSetting } from "../settings/service";

/** Rows changed per transaction. Keeps locks short and memory flat on large tables. */
export const RETENTION_BATCH = 500;
const IDEMPOTENCY_HOURS = 24;

export type RetentionOptions = {
  dryRun?: boolean;
  trigger?: "system" | "manual";
  /** Rows per transaction (tests use a small number). */
  batch?: number;
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

const FINAL_TICKET = sql`('COMPLETED','NO_SHOW','CANCELLED')`;

/**
 * One retention step on `table` (alias `t`, primary key `pk`). `where` selects the rows that are due; it must stop
 * matching once a row is processed, so a second run finds nothing. A real run changes at most `batch` rows per
 * transaction (rows locked by someone else are skipped, never waited for); a dry run only counts.
 */
async function step(
  dryRun: boolean,
  batch: number,
  table: string,
  pk: string,
  join: SQL | null,
  where: SQL,
  action: { set: SQL } | { remove: true },
): Promise<number> {
  const from = sql`${sql.raw(table)} t ${join ?? sql``}`;
  if (dryRun) {
    const r = await db().execute<{ n: string }>(sql`select count(*)::text as n from ${from} where ${where}`);
    return Number(r.rows[0]?.n ?? 0);
  }
  let total = 0;
  for (;;) {
    const n = await db().transaction(async (tx) => {
      const pick = sql`select t.${sql.raw(pk)} from ${from} where ${where} order by 1 limit ${batch} for update of t skip locked`;
      const res =
        "remove" in action
          ? await tx.execute(sql`delete from ${sql.raw(table)} where ${sql.raw(pk)} in (${pick})`)
          : await tx.execute(sql`update ${sql.raw(table)} set ${action.set} where ${sql.raw(pk)} in (${pick})`);
      return res.rowCount ?? 0;
    });
    total += n;
    if (n < batch) return total;
  }
}

const isSecurity = sql.raw(`(${SECURITY_ACTION_PREFIXES.map((p) => `t.action like '${p}%'`).join(" or ")})`);

/**
 * Applies the retention periods of one organization. Personal data is anonymised, not deleted, wherever reports need the
 * counts (tickets, visits, scores stay). Every step is idempotent and works in batches. With `dryRun` nothing changes and
 * the result says how many rows a real run would touch right now.
 */
export async function runRetention(organizationId: string, opts: RetentionOptions = {}): Promise<RetentionSummary> {
  const dryRun = !!opts.dryRun;
  const batch = Math.max(1, opts.batch ?? RETENTION_BATCH);
  const startedAt = new Date();
  const now = clockNow();
  const p = await getSetting(organizationId, "privacy");
  const org = sql`${organizationId}::uuid`;
  const counts: RetentionCounts = emptyCounts();

  const visitors = cutoff(now, p.retentionDays);
  if (visitors)
    counts.visitors = await step(
      dryRun,
      batch,
      "visitors",
      "id",
      null,
      sql`t.organization_id = ${org} and t.anonymized_at is null and coalesce(t.last_visit_at, t.created_at) < ${visitors}
        and (t.name is not null or t.phone is not null or t.phone_hash is not null or t.company is not null)`,
      {
        set: sql`name = null, name_search = null, name_translit = null, phone = null, phone_hash = null, company = null,
          last_agent_id = null, anonymized_at = ${new Date(now)}, updated_at = now()`,
      },
    );

  const tickets = cutoff(now, p.ticketDataDays);
  if (tickets) {
    counts.tickets = await step(
      dryRun,
      batch,
      "tickets",
      "id",
      null,
      sql`t.organization_id = ${org} and t.status in ${FINAL_TICKET} and coalesce(t.finished_at, t.arrived_at) < ${tickets}
        and (t.intake <> '{}'::jsonb or t.notes is not null or t.call_code is not null)`,
      { set: sql`intake = '{}'::jsonb, notes = null, call_code = null, updated_at = now()` },
    );
    counts.tickets += await step(
      dryRun,
      batch,
      "appointments",
      "id",
      null,
      sql`t.organization_id = ${org} and t.scheduled_at < ${tickets} and t.notes is not null`,
      { set: sql`notes = null, updated_at = now()` },
    );
  }

  const comments = cutoff(now, p.commentDays);
  if (comments)
    counts.comments = await step(
      dryRun,
      batch,
      "csat_responses",
      "id",
      null,
      sql`t.organization_id = ${org} and t.comment is not null and t.at < ${comments}`,
      { set: sql`comment = null` },
    );

  const notifications = cutoff(now, p.notificationDays);
  if (notifications)
    counts.notifications = await step(
      dryRun,
      batch,
      "notifications_log",
      "id",
      null,
      // Messages still waiting to go out keep their payload: it is what the sender needs.
      sql`t.organization_id = ${org} and t.created_at < ${notifications} and t.status not in ('queued','sending')
        and (t.recipient_masked is not null or t.payload <> '{}'::jsonb)`,
      { set: sql`recipient_masked = null, payload = '{}'::jsonb` },
    );

  const auditCut = auditCutoffs(now, p.auditDays);
  if (auditCut)
    counts.audit = await step(
      dryRun,
      batch,
      "audit_logs",
      "id",
      null,
      sql`t.organization_id = ${org} and (t.at < ${auditCut.security} or (t.at < ${auditCut.general} and not ${isSecurity}))`,
      { remove: true },
    );

  const credentials = cutoff(now, p.credentialDays);
  if (credentials) {
    const ofOrg = sql`join users u on u.id = t.user_id and u.organization_id = ${org}`;
    counts.sessions = await step(dryRun, batch, "sessions", "id", ofOrg, sql`t.expires_at < ${credentials}`, { remove: true });
    counts.invites = await step(
      dryRun,
      batch,
      "invites",
      "id",
      null,
      sql`t.organization_id = ${org} and coalesce(t.used_at, t.revoked_at, t.expires_at) < ${credentials}`,
      { remove: true },
    );
    counts.resetTokens = await step(
      dryRun,
      batch,
      "password_reset_tokens",
      "id",
      ofOrg,
      sql`coalesce(t.used_at, t.expires_at) < ${credentials}`,
      { remove: true },
    );
    counts.pairingCodes = await step(
      dryRun,
      batch,
      "displays",
      "id",
      null,
      sql`t.organization_id = ${org} and t.pairing_code is not null and t.pairing_expires_at < ${credentials}`,
      { set: sql`pairing_code = null, pairing_expires_at = null` },
    );
  }

  // Technical housekeeping with a fixed life: stored replies of idempotent requests (24 h, see api.md). Not organization data.
  counts.idempotencyKeys = await step(
    dryRun,
    batch,
    "idempotency_keys",
    "key",
    null,
    sql`t.created_at < ${new Date(now - IDEMPOTENCY_HOURS * 3_600_000)}`,
    { remove: true },
  );

  const summary: RetentionSummary = {
    dryRun,
    trigger: opts.trigger ?? "manual",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    counts,
  };
  if (!dryRun) {
    await audit({
      organizationId,
      actorType: opts.actorUserId ? "user" : "system",
      actorUserId: opts.actorUserId ?? null,
      ip: opts.ip,
      userAgent: opts.userAgent,
      action: "privacy.retention_run",
      entityType: "retention",
      after: summary,
    });
    logger.info({ organizationId, counts }, "retention run finished");
  }
  return summary;
}

/** The most recent real (not dry) run of the organization, newest first; null when it never ran. */
export async function lastRetentionRun(organizationId: string): Promise<RetentionSummary | null> {
  const [row] = await db()
    .select({ after: auditLogs.after })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, "privacy.retention_run")))
    .orderBy(desc(auditLogs.at))
    .limit(1);
  return (row?.after as RetentionSummary | undefined) ?? null;
}

/** Nightly pass: every organization whose last run is older than a day (or that never ran). */
export async function runDueRetention(): Promise<void> {
  const orgs = await db().select({ id: organizations.id }).from(organizations);
  for (const o of orgs) {
    try {
      const last = await lastRetentionRun(o.id);
      if (last && clockNow() - Date.parse(last.startedAt) < 23 * 3_600_000) continue;
      await runRetention(o.id, { trigger: "system" });
    } catch (err) {
      logger.error({ err, organizationId: o.id }, "retention run failed");
    }
  }
}
