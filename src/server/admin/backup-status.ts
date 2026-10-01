import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireOrgWide, type Actor } from "./actor";

/**
 * "Last backup" indicator. scripts/backup.sh and scripts/db-backup.mjs write backups/last-success.json (and
 * last-failure.json) after every run; this only reads them. Nothing here touches the database.
 */
export type BackupState = "none" | "ok" | "stale" | "failed";

export type BackupStatus = {
  state: BackupState;
  /** Directory the app looks in (BACKUP_DIR, default ./backups). In Docker it is mounted read-only. */
  lastSuccess: null | {
    finishedAt: string;
    file: string;
    bytes: number;
    encrypted: boolean;
    verifiedRestore: boolean;
    ageHours: number;
  };
  lastFailure: null | { at: string; error: string };
  /** A backup older than this many hours is reported as stale (BACKUP_MAX_AGE_HOURS, default 36). */
  maxAgeHours: number;
};

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pure part, tested without files: decides the state from the two parsed JSON documents. */
export function summarizeBackup(
  success: Record<string, unknown> | null,
  failure: Record<string, unknown> | null,
  now: Date,
  maxAgeHours: number,
): BackupStatus {
  const finishedAt = typeof success?.finishedAt === "string" ? success.finishedAt : null;
  const finishedMs = finishedAt ? Date.parse(finishedAt) : NaN;
  const lastSuccess =
    finishedAt && !Number.isNaN(finishedMs)
      ? {
          finishedAt,
          file: typeof success?.file === "string" ? success.file : "",
          bytes: typeof success?.bytes === "number" ? success.bytes : 0,
          encrypted: success?.encrypted === true,
          verifiedRestore: success?.verifiedRestore === true,
          ageHours: Math.max(0, (now.getTime() - finishedMs) / 3_600_000),
        }
      : null;
  const failureAt = typeof failure?.at === "string" ? failure.at : null;
  const lastFailure = failureAt
    ? { at: failureAt, error: typeof failure?.error === "string" ? failure.error.slice(0, 300) : "" }
    : null;
  // A failure newer than the last success wins: the latest run is what matters.
  const failedLast = lastFailure && (!lastSuccess || Date.parse(lastFailure.at) > Date.parse(lastSuccess.finishedAt));
  const state: BackupState = failedLast ? "failed" : !lastSuccess ? "none" : lastSuccess.ageHours > maxAgeHours ? "stale" : "ok";
  return { state, lastSuccess, lastFailure: failedLast ? lastFailure : null, maxAgeHours };
}

export function backupStatus(actor: Actor, now = new Date()): BackupStatus {
  requireOrgWide(actor, "settings.manage");
  const dir = path.resolve(process.cwd(), process.env.BACKUP_DIR ?? "backups");
  const maxAge = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 36);
  return summarizeBackup(
    readJson(path.join(dir, "last-success.json")),
    readJson(path.join(dir, "last-failure.json")),
    now,
    maxAge > 0 ? maxAge : 36,
  );
}
