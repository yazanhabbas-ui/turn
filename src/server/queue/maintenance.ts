import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, tickets } from "@/db/schema";
import { logger } from "../logger";
import { maintainBranch } from "./tickets";

const INTERVAL_MS = 15_000;
const g = globalThis as unknown as { __dorQueueTimer?: NodeJS.Timeout; __dorQueueRunning?: boolean };

/** One pass: branches that have tickets in play get their timers evaluated (recalls, no-shows, hybrid releases). */
export async function runQueueMaintenance() {
  if (g.__dorQueueRunning) return;
  g.__dorQueueRunning = true;
  try {
    const active = await db()
      .selectDistinct({ id: tickets.branchId })
      .from(tickets)
      .innerJoin(branches, and(eq(branches.id, tickets.branchId), isNull(branches.archivedAt)))
      .where(inArray(tickets.status, ["WAITING", "CALLED"]));
    for (const b of active) {
      try {
        await maintainBranch(b.id);
      } catch (err) {
        logger.error({ err, branchId: b.id }, "queue maintenance failed");
      }
    }
  } finally {
    g.__dorQueueRunning = false;
  }
}

/** Safe on several app nodes at once: every branch pass runs under the branch advisory lock. */
export function startQueueMaintenance() {
  if (g.__dorQueueTimer) return;
  g.__dorQueueTimer = setInterval(() => void runQueueMaintenance(), INTERVAL_MS);
  g.__dorQueueTimer.unref();
}

export function stopQueueMaintenance() {
  if (g.__dorQueueTimer) clearInterval(g.__dorQueueTimer);
  g.__dorQueueTimer = undefined;
}
