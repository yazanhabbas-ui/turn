import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { cityReasons } from "@/db/schema";

/** Reasons a city has switched off (by default every organization reason is enabled in every city). */
export async function hiddenReasonIds(cityId: string, tx: DbOrTx = db()): Promise<Set<string>> {
  const rows = await tx
    .select({ reasonId: cityReasons.reasonId })
    .from(cityReasons)
    .where(and(eq(cityReasons.cityId, cityId), eq(cityReasons.enabled, false)));
  return new Set(rows.map((r) => r.reasonId));
}

export async function isReasonHiddenInCity(cityId: string, reasonId: string, tx: DbOrTx = db()): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: cityReasons.enabled })
    .from(cityReasons)
    .where(and(eq(cityReasons.cityId, cityId), eq(cityReasons.reasonId, reasonId)));
  return row?.enabled === false;
}
