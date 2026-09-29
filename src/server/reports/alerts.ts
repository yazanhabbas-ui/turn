import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProfiles, alerts, branches, tickets } from "@/db/schema";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { AppError } from "../http/errors";
import { enqueue } from "../jobs";
import { logger } from "../logger";
import { publish } from "../queue/publish";
import { getSetting } from "../settings/service";
import { auditMeta, orgOf, requirePermission, type Actor } from "../admin/actor";
import { branchesFor } from "@/domain/rbac/permissions";

const MIN = 60_000;
/** An alert of the same kind for the same thing is not raised again inside this window. */
const REPEAT_MS = 60 * MIN;

export type AlertCandidate = {
  type: "long_wait" | "queue_over_limit" | "agent_idle" | "no_show_spike";
  severity: "warning" | "critical";
  dedupeKey: string;
  payload: Record<string, unknown>;
};

/** What is wrong right now in one branch, according to the organization's thresholds. */
export async function findAnomalies(branchId: string, now = clockNow()): Promise<AlertCandidate[]> {
  const [branch] = await db().select().from(branches).where(eq(branches.id, branchId));
  if (!branch) return [];
  const cfg = await getSetting(branch.organizationId, "alerts", branchId);
  if (!cfg.enabled) return [];
  const out: AlertCandidate[] = [];

  const open = await db()
    .select({
      id: tickets.id,
      displayNumber: tickets.displayNumber,
      status: tickets.status,
      arrivedAt: tickets.arrivedAt,
      reasonId: tickets.reasonId,
    })
    .from(tickets)
    .where(and(eq(tickets.branchId, branchId), inArray(tickets.status, ["WAITING", "CALLED", "SERVING"])));
  const waiting = open.filter((t) => t.status === "WAITING");

  for (const t of waiting) {
    const waited = (now - t.arrivedAt.getTime()) / MIN;
    if (waited >= cfg.longWaitMinutes) {
      out.push({
        type: "long_wait",
        severity: waited >= cfg.longWaitMinutes * 2 ? "critical" : "warning",
        dedupeKey: `long_wait:${t.id}`,
        payload: {
          ticketId: t.id,
          displayNumber: t.displayNumber,
          reasonId: t.reasonId,
          waitMin: Math.round(waited),
          limit: cfg.longWaitMinutes,
        },
      });
    }
  }

  if (waiting.length >= cfg.queueLimit) {
    out.push({
      type: "queue_over_limit",
      severity: waiting.length >= cfg.queueLimit * 2 ? "critical" : "warning",
      dedupeKey: `queue_over_limit:${branchId}`,
      payload: { waiting: waiting.length, limit: cfg.queueLimit },
    });
  }

  if (waiting.length > 0) {
    const idle = await db()
      .select()
      .from(agentProfiles)
      .where(and(eq(agentProfiles.branchId, branchId), eq(agentProfiles.status, "AVAILABLE")));
    for (const a of idle) {
      const since = (a.lastIdleSince ?? a.statusChangedAt).getTime();
      if ((now - since) / MIN < cfg.agentIdleMinutes) continue;
      out.push({
        type: "agent_idle",
        severity: "warning",
        dedupeKey: `agent_idle:${a.userId}`,
        payload: {
          agentId: a.userId,
          idleMin: Math.round((now - since) / MIN),
          waiting: waiting.length,
          limit: cfg.agentIdleMinutes,
        },
      });
    }
  }

  const since = new Date(now - cfg.noShowWindowMinutes * MIN);
  const [ns] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.branchId, branchId), eq(tickets.status, "NO_SHOW"), gte(tickets.finishedAt, since)));
  if (ns.n >= cfg.noShowCount) {
    out.push({
      type: "no_show_spike",
      severity: "warning",
      dedupeKey: `no_show_spike:${branchId}`,
      payload: { count: ns.n, windowMinutes: cfg.noShowWindowMinutes, limit: cfg.noShowCount },
    });
  }
  return out;
}

/**
 * Records new anomalies as in-app alerts, pushes them to the wallboard in real time and (optionally) emails the
 * supervisors. The same condition is not raised again for an hour, or while its alert is still unacknowledged.
 */
export async function raiseAlerts(branchId: string, now = clockNow()): Promise<number> {
  const found = await findAnomalies(branchId, now);
  if (!found.length) return 0;
  const [branch] = await db().select().from(branches).where(eq(branches.id, branchId));
  const cfg = await getSetting(branch.organizationId, "alerts", branchId);
  let raised = 0;
  for (const c of found) {
    const [recent] = await db()
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.organizationId, branch.organizationId),
          eq(alerts.dedupeKey, c.dedupeKey),
          gte(alerts.createdAt, new Date(now - REPEAT_MS)),
        ),
      )
      .limit(1);
    const [stillOpen] = recent
      ? [recent]
      : await db()
          .select({ id: alerts.id })
          .from(alerts)
          .where(
            and(
              eq(alerts.organizationId, branch.organizationId),
              eq(alerts.dedupeKey, c.dedupeKey),
              isNull(alerts.acknowledgedAt),
            ),
          )
          .limit(1);
    if (stillOpen) continue;
    const [row] = await db()
      .insert(alerts)
      .values({
        organizationId: branch.organizationId,
        branchId,
        type: c.type,
        severity: c.severity,
        payload: c.payload,
        dedupeKey: c.dedupeKey,
        createdAt: new Date(now),
      })
      .returning();
    raised++;
    publish([{ type: "alert.raised", branchId, alertType: c.type, payload: { id: row.id, severity: c.severity, ...c.payload } }]);
    for (const to of cfg.notifyEmails) {
      try {
        await enqueue("messages.send", {
          organizationId: branch.organizationId,
          branchId,
          channel: "email",
          event: "alert_raised",
          to,
          locale: "ar",
          vars: { type: c.type, branch: branch.name.ar ?? branch.name.en ?? "", details: JSON.stringify(c.payload) },
        });
      } catch (err) {
        logger.warn({ err }, "alert email not queued");
      }
    }
  }
  return raised;
}

/* ---------- API-facing ---------- */

export async function listAlerts(actor: Actor, opts: { openOnly?: boolean; limit?: number } = {}) {
  requirePermission(actor, "alerts.view");
  const allowed = branchesFor(actor.auth.grants, "alerts.view");
  const rows = await db()
    .select()
    .from(alerts)
    .where(and(eq(alerts.organizationId, orgOf(actor)), opts.openOnly ? isNull(alerts.acknowledgedAt) : undefined))
    .orderBy(desc(alerts.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows
    .filter((a) => allowed === "all" || (a.branchId !== null && allowed.includes(a.branchId)))
    .map((a) => ({
      id: a.id,
      branchId: a.branchId,
      type: a.type,
      severity: a.severity,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    }));
}

export async function acknowledgeAlert(actor: Actor, id: string) {
  requirePermission(actor, "alerts.manage");
  const [a] = await db()
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.organizationId, orgOf(actor))));
  if (!a) throw new AppError("not_found");
  requirePermission(actor, "alerts.manage", a.branchId);
  if (a.acknowledgedAt) return { ok: true };
  await db()
    .update(alerts)
    .set({ acknowledgedAt: new Date(clockNow()), acknowledgedByUserId: actor.auth.user.id })
    .where(eq(alerts.id, id));
  await audit({ ...auditMeta(actor), branchId: a.branchId, action: "alert.acknowledged", entityType: "alert", entityId: id });
  if (a.branchId) publish([{ type: "queue.updated", branchId: a.branchId, cause: "alert.ack" }]);
  return { ok: true };
}
