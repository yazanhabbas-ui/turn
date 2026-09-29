import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** A translatable string: `{ ar: "…", en: "…" }`. Any locale code may be added without a schema change. */
export type LocalizedText = Record<string, string>;

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

/** Soft delete / archive marker for configuration rows. Rows referenced by history are never hard-deleted. */
export const archivedAt = () => timestamp("archived_at", { withTimezone: true });

export const ts = (name: string) => timestamp(name, { withTimezone: true });
