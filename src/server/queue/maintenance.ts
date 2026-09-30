import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProfiles, branches, tickets } from "@/db/schema";
import { logger } from "../logger";
import { raiseAlerts } from "../reports/alerts";
import { maintainBranch } from "./tickets";

const INTERVAL_MS = 15_000;
/** Anomaly checks are cheaper to run less often than the queue timers. */
const ALERT_EVERY_MS = 60_000;
const lastAlertPass = new Map<string, number>();
const g = globalThis as unknown as { __dorQueueTimer?: NodeJS.Timeout; __dorQueueRunning?: boolean };

/** One pass: branches that have tickets in play get their timers evaluated (recalls, no-shows, hybrid releases). */
export async function runQueueMaintenance() {
  if (g.__dorQueueRunning) return;
  g.__dorQueueRunning = true;
  try {
    // Branches with visitors in play, or with agents signed in (their break line and shift end need attention too).
    const withTickets = await db()
      .selectDistinct({ id: tickets.branchId })
      .from(tickets)
      .innerJoin(branches, and(eq(branches.id, tickets.branchId), isNull(branches.archivedAt)))
      .where(inArray(tickets.status, ["WAITING", "CALLED"]));
    const withAgents = await db()
      .selectDistinct({ id: agentProfiles.branchId })
      .from(agentProfiles)
      .innerJoin(branches, and(eq(branches.id, agentProfiles.branchId), isNull(branches.archivedAt)))
      .where(ne(agentProfiles.status, "OFFLINE"));
    const active = [...new Map([...withTickets, ...withAgents].map((b) => [b.id, b])).values()];
    for (const b of active) {
      try {
        await maintainBranch(b.id);
        if (Date.now() - (lastAlertPass.get(b.id) ?? 0) >= ALERT_EVERY_MS) {
          lastAlertPass.set(b.id, Date.now());
          await raiseAlerts(b.id);
        }
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
