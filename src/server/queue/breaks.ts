import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agentProfiles, breakRequests } from "@/db/schema";
import { getSetting } from "../settings/service";
import type { QueueEvent } from "./publish";

/** What the break logic needs from a queue transaction (see `withBranch`). */
export type BreakCtx = { tx: Tx; now: number; organizationId: string; branchId: string; events: QueueEvent[] };

export type BreakLimit = { enabled: boolean; limit: number; holdMinutes: number };

/**
 * How many agents of the branch may be on a break at once: a fixed number, or a share of the agents who are signed
 * in (at least one). Unlimited when the feature is switched off.
 */
export async function breakLimit(ctx: BreakCtx): Promise<BreakLimit> {
  const cfg = await getSetting(ctx.organizationId, "breaks", ctx.branchId, ctx.tx);
  if (!cfg.enabled) return { enabled: false, limit: Number.MAX_SAFE_INTEGER, holdMinutes: cfg.holdMinutes };
  let limit = cfg.maxOnBreak.value;
  if (cfg.maxOnBreak.mode === "percent") {
    const [row] = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentProfiles)
      .where(and(eq(agentProfiles.branchId, ctx.branchId), ne(agentProfiles.status, "OFFLINE")));
    limit = Math.max(1, Math.floor((row.n * cfg.maxOnBreak.value) / 100));
  }
  return { enabled: true, limit, holdMinutes: cfg.holdMinutes };
}

async function openRequests(ctx: BreakCtx) {
  return ctx.tx
    .select()
    .from(breakRequests)
    .where(and(eq(breakRequests.branchId, ctx.branchId), inArray(breakRequests.status, ["waiting", "offered"])))
    .orderBy(asc(breakRequests.seq));
}

/** Places taken: agents on a break, plus places held for someone who was offered one and has not taken it yet. */
async function placesTaken(ctx: BreakCtx, exceptUserId?: string) {
  const [onBreak] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.branchId, ctx.branchId),
        eq(agentProfiles.status, "ON_BREAK"),
        exceptUserId ? ne(agentProfiles.userId, exceptUserId) : undefined,
      ),
    );
  const held = (await openRequests(ctx)).filter(
    (r) => r.status === "offered" && r.userId !== exceptUserId && (r.offerExpiresAt?.getTime() ?? 0) > ctx.now,
  );
  return { onBreak: onBreak.n, held: held.length };
}

export type BreakDecision = { granted: true } | { granted: false; onBreak: number; limit: number; position: number };

type BreakUpdate = Extract<QueueEvent, { type: "break.update" }>;

function notify(ctx: BreakCtx, agentId: string, kind: BreakUpdate["kind"], extra: Partial<BreakUpdate> = {}) {
  ctx.events.push({ type: "break.update", branchId: ctx.branchId, agentId, kind, ...extra });
}

/**
 * An agent asks to start a break. Granted when there is a free place and nobody is waiting ahead; otherwise the
 * agent joins the waiting line (once) and is told how many colleagues are on a break and their place in line.
 */
export async function requestBreak(ctx: BreakCtx, userId: string, breakTypeId: string | null): Promise<BreakDecision> {
  const { limit } = await breakLimit(ctx);
  const open = await openRequests(ctx);
  const mine = open.find((r) => r.userId === userId);
  const taken = await placesTaken(ctx, userId);
  const occupied = taken.onBreak + taken.held;

  // The agent was offered a place and it is still valid: take it.
  if (mine?.status === "offered" && (mine.offerExpiresAt?.getTime() ?? 0) > ctx.now) {
    await ctx.tx
      .update(breakRequests)
      .set({ status: "taken", resolvedAt: new Date(ctx.now) })
      .where(eq(breakRequests.id, mine.id));
    return { granted: true };
  }
  const line0 = open.filter((r) => r.status === "waiting");
  if (occupied < limit && (line0.length === 0 || line0[0].userId === userId)) {
    if (mine)
      await ctx.tx
        .update(breakRequests)
        .set({ status: "taken", resolvedAt: new Date(ctx.now) })
        .where(eq(breakRequests.id, mine.id));
    return { granted: true };
  }

  // Join (or stay in) the line. An offer that ran out counts as leaving it: the agent goes to the back.
  if (mine?.status === "offered") {
    await ctx.tx
      .update(breakRequests)
      .set({ status: "expired", resolvedAt: new Date(ctx.now) })
      .where(eq(breakRequests.id, mine.id));
  }
  if (!mine || mine.status === "offered") {
    await ctx.tx.insert(breakRequests).values({
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      userId,
      breakTypeId,
      requestedAt: new Date(ctx.now),
    });
  }
  const line = (await openRequests(ctx)).filter((r) => r.status === "waiting");
  const position = Math.max(1, line.findIndex((r) => r.userId === userId) + 1);
  const decision = { granted: false as const, onBreak: taken.onBreak, limit, position };
  notify(ctx, userId, "queued", { onBreak: decision.onBreak, limit, position });
  return decision;
}

/** The agent no longer wants the break (chose another status, or cancelled). */
export async function cancelBreakRequest(ctx: BreakCtx, userId: string) {
  const open = (await openRequests(ctx)).filter((r) => r.userId === userId);
  if (!open.length) return false;
  await ctx.tx
    .update(breakRequests)
    .set({ status: "cancelled", resolvedAt: new Date(ctx.now) })
    .where(
      inArray(
        breakRequests.id,
        open.map((r) => r.id),
      ),
    );
  notify(ctx, userId, "cancelled");
  return true;
}

/**
 * Expires offers nobody took in time, then offers every free place to the agents waiting longest. Each of them is
 * notified. Call after any status change and from the periodic maintenance.
 */
export async function offerFreedBreaks(ctx: BreakCtx) {
  const { enabled, limit, holdMinutes } = await breakLimit(ctx);
  const late = await ctx.tx
    .update(breakRequests)
    .set({ status: "expired", resolvedAt: new Date(ctx.now) })
    .where(
      and(
        eq(breakRequests.branchId, ctx.branchId),
        eq(breakRequests.status, "offered"),
        lte(breakRequests.offerExpiresAt, new Date(ctx.now)),
      ),
    )
    .returning({ userId: breakRequests.userId });
  for (const r of late) notify(ctx, r.userId, "expired");

  const open = await openRequests(ctx);
  const waiting = open.filter((r) => r.status === "waiting");
  if (!waiting.length) return;
  const taken = await placesTaken(ctx);
  let free = enabled ? limit - taken.onBreak - taken.held : waiting.length;
  for (const r of waiting) {
    if (free <= 0) break;
    const expires = new Date(ctx.now + holdMinutes * 60_000);
    await ctx.tx
      .update(breakRequests)
      .set({ status: "offered", offeredAt: new Date(ctx.now), offerExpiresAt: expires })
      .where(eq(breakRequests.id, r.id));
    notify(ctx, r.userId, "available", { expiresAt: expires.toISOString(), holdMinutes });
    free--;
  }
}

/** For the agent's own screen: how the break line looks right now. */
export async function breakStatus(ctx: BreakCtx, userId: string) {
  const { enabled, limit } = await breakLimit(ctx);
  const [onBreak] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(agentProfiles)
    .where(and(eq(agentProfiles.branchId, ctx.branchId), eq(agentProfiles.status, "ON_BREAK")));
  const open = await openRequests(ctx);
  const mine = open.find((r) => r.userId === userId);
  const waiting = open.filter((r) => r.status === "waiting");
  return {
    enabled,
    limit: enabled ? limit : null,
    onBreak: onBreak.n,
    request: mine
      ? {
          status: mine.status as "waiting" | "offered",
          position: mine.status === "waiting" ? waiting.findIndex((r) => r.userId === userId) + 1 : 0,
          offerExpiresAt: mine.offerExpiresAt?.toISOString() ?? null,
        }
      : null,
  };
}
