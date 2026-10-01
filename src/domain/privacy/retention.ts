/** Pure rules of the data-retention job (D56). The database work lives in src/server/privacy. */

/** Security-critical audit entries are never removed before this age, whatever the audit period says. */
export const AUDIT_SECURITY_MIN_DAYS = 365;
/** Other audit entries are never removed before this age (an administrator typing 1 by mistake must not wipe the trail). */
export const AUDIT_MIN_DAYS = 30;

/** Audit actions (prefix match) that are security-critical: sign-in, accounts, roles, invitations, privacy, keys, settings, screens. */
export const SECURITY_ACTION_PREFIXES = [
  "auth.",
  "user.",
  "role.",
  "invite.",
  "privacy.",
  "apikey.",
  "webhook.",
  "setting.",
  "display.",
] as const;

export const isSecurityAction = (action: string) => SECURITY_ACTION_PREFIXES.some((p) => action.startsWith(p));

export const DAY_MS = 86_400_000;

/** Rows older than the returned instant are due; null when the period is 0 (keep forever). */
export function cutoff(now: number, days: number): Date | null {
  return days > 0 ? new Date(now - days * DAY_MS) : null;
}

/** Effective audit periods: the configured one, raised to the minimums. null = keep forever. */
export function auditCutoffs(now: number, days: number): { general: Date; security: Date } | null {
  if (days <= 0) return null;
  return {
    general: new Date(now - Math.max(days, AUDIT_MIN_DAYS) * DAY_MS),
    security: new Date(now - Math.max(days, AUDIT_SECURITY_MIN_DAYS) * DAY_MS),
  };
}

export const RETENTION_KEYS = [
  "visitors",
  "tickets",
  "comments",
  "notifications",
  "audit",
  "sessions",
  "invites",
  "resetTokens",
  "pairingCodes",
  "idempotencyKeys",
] as const;
export type RetentionKey = (typeof RETENTION_KEYS)[number];
export type RetentionCounts = Record<RetentionKey, number>;

export type RetentionSummary = {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  /** `system` for the nightly run, `manual` for the button. */
  trigger: "system" | "manual";
  counts: RetentionCounts;
};

export const emptyCounts = (): RetentionCounts => Object.fromEntries(RETENTION_KEYS.map((k) => [k, 0])) as RetentionCounts;
