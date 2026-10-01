import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { branches, settings } from "@/db/schema";
import { parseSetting, type SettingKey, type SettingValue } from "./registry";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    // A stored value is parsed from JSON, where "__proto__" is an ordinary key: never let it reach the prototype.
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

/** Where a setting's effective value comes from: the organization default, a city override or a branch override. */
export type SettingSource = {
  level: "organization" | "city" | "branch";
  /** The city whose override applies (level "city"); for "branch" it is the branch's city. */
  cityId: string | null;
  branchId: string | null;
};

/** Which place to resolve for: a branch (its city is looked up), or a city on its own. */
export type SettingScopeRef = { branchId?: string | null; cityId?: string | null };

/**
 * Resolved setting with its source: defaults ← organization value ← city override ← branch override (the most
 * specific wins). One query: the branch's city is resolved in SQL. `source` is the most specific level that exists.
 */
export async function resolveSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
  scope: SettingScopeRef = {},
  tx: DbOrTx = db(),
): Promise<{ value: SettingValue<K>; source: SettingSource }> {
  const { branchId, cityId } = scope;
  const cityMatch = branchId
    ? eq(settings.cityId, sql`(select ${branches.cityId} from ${branches} where ${branches.id} = ${branchId})`)
    : cityId
      ? eq(settings.cityId, cityId)
      : undefined;
  const rows = await tx
    .select({ branchId: settings.branchId, cityId: settings.cityId, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.organizationId, organizationId),
        eq(settings.key, key),
        or(
          and(isNull(settings.branchId), isNull(settings.cityId)),
          cityMatch,
          branchId ? eq(settings.branchId, branchId) : undefined,
        ),
      ),
    );
  const org = rows.find((r) => r.branchId === null && r.cityId === null);
  const city = rows.find((r) => r.cityId !== null);
  const branch = rows.find((r) => r.branchId !== null);
  const source: SettingSource = branch
    ? { level: "branch", cityId: city?.cityId ?? null, branchId: branch.branchId }
    : city
      ? { level: "city", cityId: city.cityId, branchId: null }
      : { level: "organization", cityId: null, branchId: null };
  return {
    value: parseSetting(key, deepMerge(deepMerge(org?.value ?? {}, city?.value ?? {}), branch?.value ?? {})),
    source,
  };
}

/** Resolved setting: defaults ← organization value ← the branch's city override ← branch override. */
export async function getSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
  branchId?: string | null,
  tx: DbOrTx = db(),
): Promise<SettingValue<K>> {
  return (await resolveSetting(organizationId, key, { branchId }, tx)).value;
}

/** Same as `getSetting` plus where the effective value comes from (for the "source" badges in Admin → Settings). */
export async function getSettingSource<K extends SettingKey>(
  organizationId: string,
  key: K,
  scope: SettingScopeRef = {},
  tx: DbOrTx = db(),
): Promise<{ value: SettingValue<K>; source: SettingSource }> {
  return resolveSetting(organizationId, key, scope, tx);
}

export async function putSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
  value: SettingValue<K>,
  opts: { branchId?: string | null; cityId?: string | null; userId?: string | null } = {},
  tx: DbOrTx = db(),
): Promise<void> {
  if (opts.branchId && opts.cityId) throw new Error("a setting has either a city or a branch scope, not both");
  await tx
    .insert(settings)
    .values({
      organizationId,
      branchId: opts.branchId ?? null,
      cityId: opts.cityId ?? null,
      key,
      value,
      updatedByUserId: opts.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [settings.organizationId, settings.cityId, settings.branchId, settings.key],
      set: { value, updatedByUserId: opts.userId ?? null, updatedAt: new Date() },
    });
}
