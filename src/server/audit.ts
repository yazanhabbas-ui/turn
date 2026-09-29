import { db, type DbOrTx } from "@/db/client";
import { auditLogs } from "@/db/schema";

export type AuditEntry = {
  organizationId: string;
  branchId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "device" | "api_key";
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

const SECRET_FIELDS = new Set(["passwordHash", "totpSecretEnc", "tokenHash", "keyHash", "secret"]);

/** Strips secrets before a snapshot is stored in the audit trail. */
function scrub(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(scrub);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !SECRET_FIELDS.has(k))
      .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : scrub(v)]),
  );
}

/** Records who changed what. Call inside the same transaction as the change. */
export async function audit(entry: AuditEntry, tx: DbOrTx = db()): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    branchId: entry.branchId ?? null,
    actorType: entry.actorType ?? "user",
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: scrub(entry.before),
    after: scrub(entry.after),
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 400) ?? null,
  });
}
