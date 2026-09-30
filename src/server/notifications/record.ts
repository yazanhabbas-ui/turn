import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { notificationsLog, tickets, visitors } from "@/db/schema";
import { waitValueText } from "@/domain/distribution/estimate";
import { dedupeKeyFor, looksLikeEmail, orderChannels, shouldSkip, type NotifyChannel } from "@/domain/notifications/policy";
import { maskRecipient } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { logger } from "../logger";
import type { BranchContext } from "../queue/snapshot";
import { positionsFor } from "../queue/positions";
import type { NotificationEvent } from "../settings/registry";
import { getSetting } from "../settings/service";

export type NotifyRequest = { ticketId: string; event: NotificationEvent };

/** How many people are ahead of each waiting ticket that has a visitor record, before a mutation runs. */
export function aheadBefore(bctx: BranchContext): Map<string, number> {
  if (!bctx.visitorTicketIds.size) return new Map();
  const out = new Map<string, number>();
  for (const [id, p] of positionsFor(bctx)) if (bctx.visitorTicketIds.has(id)) out.set(id, p.ahead);
  return out;
}

/**
 * Outbox: writes one `queued` row per notification in the caller's transaction, so a rollback leaves nothing behind and
 * a commit can never lose a message. Returns the ids to hand to the worker after commit. Failures here are logged and
 * swallowed (inside a savepoint), so notifications can never break issuing or calling.
 */
export async function recordNotifications(
  tx: Tx,
  input: {
    bctx: BranchContext;
    requests: NotifyRequest[];
    /** Waiting positions before the mutation (see aheadBefore) and whether anything changed. */
    before: Map<string, number>;
    changed: boolean;
    /** Loads the branch state after the mutation. */
    reload: () => Promise<BranchContext>;
  },
): Promise<string[]> {
  try {
    return await tx.transaction((sp) => record(sp as unknown as Tx, input));
  } catch (err) {
    logger.error({ err, branchId: input.bctx.branch.id }, "recording visitor notifications failed");
    return [];
  }
}

async function record(tx: Tx, input: Parameters<typeof recordNotifications>[1]): Promise<string[]> {
  const { bctx } = input;
  const org = bctx.branch.organizationId;
  const branchId = bctx.branch.id;
  const settings = await getSetting(org, "notifications", branchId, tx);
  if (!settings.enabled) return [];

  const requests = [...input.requests];
  // "N turns away": a waiting visitor whose position moved from beyond N to within N since before this change.
  if (input.changed && settings.events.turns_away.enabled && input.before.size) {
    const { notifyTurnsAway: n } = await getSetting(org, "visitorStatus", branchId, tx);
    const candidates = [...input.before].filter(([, ahead]) => ahead > n).map(([id]) => id);
    if (candidates.length) {
      const now = positionsFor(await input.reload());
      for (const id of candidates) {
        const p = now.get(id);
        if (p && p.ahead <= n) requests.push({ ticketId: id, event: "turns_away" });
      }
    }
  }
  if (!requests.length) return [];

  const rows = await tx
    .select({ t: tickets, v: visitors })
    .from(tickets)
    .leftJoin(visitors, eq(visitors.id, tickets.visitorId))
    .where(
      inArray(
        tickets.id,
        requests.map((r) => r.ticketId),
      ),
    );
  const byId = new Map(rows.map((r) => [r.t.id, r]));
  let fresh: BranchContext | null = null;
  let positions: ReturnType<typeof positionsFor> | null = null;
  const queued: string[] = [];

  for (const req of requests) {
    const row = byId.get(req.ticketId);
    if (!row) continue;
    const { t, v } = row;
    const eventCfg = settings.events[req.event];
    const phone = v?.phone ?? null;
    const email = looksLikeEmail(t.intake?.email) ? t.intake.email.trim() : null;
    if (!eventCfg.enabled || (!phone && !email)) continue; // nothing to send, nothing to log

    const channels = orderChannels({
      order: settings.channelOrder,
      allowedForEvent: eventCfg.channels,
      contacts: { phone: !!phone, email: !!email },
    });
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsLog)
      .where(and(eq(notificationsLog.ticketId, t.id), inArray(notificationsLog.status, ["queued", "sending", "sent"])));
    const skip = shouldSkip({
      enabled: settings.enabled,
      eventEnabled: eventCfg.enabled,
      hasContact: true,
      requireConsent: settings.requireConsent,
      consent: !!t.consentAt,
      optedOut: !!v?.notificationsOptOut,
      countedForTicket: n,
      maxPerTicket: settings.limits.maxPerTicket,
      channels,
    });

    // The position and wait as they are after this change.
    let ahead = "";
    let wait = "";
    if (!skip && t.status === "WAITING" && (req.event === "ticket_issued" || req.event === "turns_away")) {
      fresh ??= await input.reload();
      positions ??= positionsFor(fresh);
      const p = positions.get(t.id);
      if (p) {
        ahead = String(p.ahead);
        const w = fresh.wait.settings;
        if (w.showOnTicket && p.ahead > 0)
          wait = waitValueText({ minutes: p.estimatedWaitMinutes, low: p.waitLow, high: p.waitHigh }, w, (text) =>
            pickText(text, t.language),
          ).text;
      }
    }

    const primary = channels[0] as NotifyChannel | undefined;
    const to = primary === "email" ? email : phone;
    const [inserted] = await tx
      .insert(notificationsLog)
      .values({
        organizationId: org,
        branchId,
        ticketId: t.id,
        channel: primary ?? "none",
        provider: "none",
        event: req.event,
        recipientMasked: to ? maskRecipient(to) : null,
        status: skip ? "skipped" : "queued",
        error: skip ?? null,
        dedupeKey: dedupeKeyFor(t.id, req.event),
        nextAttemptAt: skip ? null : new Date(),
        payload: { locale: t.language, channels, cursor: { index: 0, tries: 0 }, ahead, wait },
      })
      .onConflictDoNothing({ target: notificationsLog.dedupeKey })
      .returning({ id: notificationsLog.id });
    if (inserted && !skip) queued.push(inserted.id);
  }
  return queued;
}
