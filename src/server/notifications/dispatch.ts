import { logger } from "../logger";
import { enqueue } from "../jobs";
import { dueNotificationIds } from "./deliver";

const pending = new Set<Promise<unknown>>();

/**
 * Hands committed outbox rows to the job runner. Fire-and-forget: issuing and calling never wait for a provider,
 * and a failure to queue is only logged because the sweeper picks the row up again.
 */
export function dispatchNotifications(ids: string[]) {
  if (!ids.length) return;
  const p = (async () => {
    for (const logId of ids) {
      try {
        await enqueue("notifications.deliver", { logId });
      } catch (err) {
        logger.warn({ err, logId }, "could not queue visitor notification");
      }
    }
  })();
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Waits until every dispatched notification has been handled (tests and shutdown). */
export async function flushNotifications() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** Safety net, run by the queue maintenance loop: re-queues notifications whose job was lost. */
export async function sweepNotifications() {
  try {
    dispatchNotifications(await dueNotificationIds());
  } catch (err) {
    logger.warn({ err }, "notification sweep failed");
  }
}
