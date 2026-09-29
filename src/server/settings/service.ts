import { and, eq, isNull, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { settings } from "@/db/schema";
import { parseSetting, type SettingKey, type SettingValue } from "./registry";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

/** Resolved setting: defaults ← organization value ← branch override. */
export async function getSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
  branchId?: string | null,
  tx: DbOrTx = db(),
): Promise<SettingValue<K>> {
  const rows = await tx
    .select({ branchId: settings.branchId, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.organizationId, organizationId),
        eq(settings.key, key),
        branchId ? or(isNull(settings.branchId), eq(settings.branchId, branchId)) : isNull(settings.branchId),
      ),
    );
  const org = rows.find((r) => r.branchId === null)?.value;
  const branch = rows.find((r) => r.branchId !== null)?.value;
  return parseSetting(key, deepMerge(org ?? {}, branch ?? {}));
}

export async function putSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
  value: SettingValue<K>,
  opts: { branchId?: string | null; userId?: string | null } = {},
  tx: DbOrTx = db(),
): Promise<void> {
  await tx
    .insert(settings)
    .values({ organizationId, branchId: opts.branchId ?? null, key, value, updatedByUserId: opts.userId ?? null })
    .onConflictDoUpdate({
      target: [settings.organizationId, settings.branchId, settings.key],
      set: { value, updatedByUserId: opts.userId ?? null, updatedAt: new Date() },
    });
}
