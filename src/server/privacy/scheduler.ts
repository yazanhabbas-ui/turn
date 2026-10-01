import { logger } from "../logger";
import { runDueRetention } from "./retention";

const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_CHECK_MS = 2 * 60_000;
const g = globalThis as unknown as {
  __dorRetentionTimer?: NodeJS.Timeout;
  __dorRetentionFirst?: NodeJS.Timeout;
  __dorRetentionRunning?: boolean;
};

async function tick() {
  if (g.__dorRetentionRunning) return;
  g.__dorRetentionRunning = true;
  try {
    await runDueRetention();
  } catch (err) {
    logger.error({ err }, "retention check failed");
  } finally {
    g.__dorRetentionRunning = false;
  }
}

/**
 * Data retention runs about once a day: every hour the app checks whether the organization's last run is older than
 * 23 hours (it is recorded in the audit trail), so a restart never skips or doubles a day. Not tied to opening hours.
 * Runs are idempotent and skip rows other nodes are working on, so several app nodes can share this safely.
 */
export function startRetentionScheduler() {
  if (g.__dorRetentionTimer) return;
  g.__dorRetentionFirst = setTimeout(() => void tick(), FIRST_CHECK_MS);
  g.__dorRetentionFirst.unref();
  g.__dorRetentionTimer = setInterval(() => void tick(), CHECK_EVERY_MS);
  g.__dorRetentionTimer.unref();
}

export function stopRetentionScheduler() {
  if (g.__dorRetentionTimer) clearInterval(g.__dorRetentionTimer);
  if (g.__dorRetentionFirst) clearTimeout(g.__dorRetentionFirst);
  g.__dorRetentionTimer = undefined;
  g.__dorRetentionFirst = undefined;
}
