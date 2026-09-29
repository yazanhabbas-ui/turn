import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept `Db | Tx` so they compose inside an outer transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

type Globals = { __dorPool?: Pool; __dorDb?: Db };
const g = globalThis as unknown as Globals;

export function pool(): Pool {
  if (!g.__dorPool) {
    g.__dorPool = new Pool({ connectionString: env().DATABASE_URL, max: env().DATABASE_POOL_MAX });
  }
  return g.__dorPool;
}

/** Shared Drizzle instance (one per process; survives Next.js dev hot reloads). */
export function db(): Db {
  if (!g.__dorDb) g.__dorDb = drizzle(pool(), { schema });
  return g.__dorDb;
}

export { schema };
