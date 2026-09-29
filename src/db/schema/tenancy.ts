import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, updatedAt, type LocalizedText } from "./_common";

export const organizations = pgTable("organizations", {
  id: id(),
  name: jsonb("name").$type<LocalizedText>().notNull(),
  slug: text("slug").notNull().unique(),
  defaultLocale: text("default_locale").notNull().default("ar"),
  /** Locales enabled for UI and content, in display order. */
  locales: jsonb("locales").$type<string[]>().notNull().default(["ar", "en"]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Weekend expressed as JS weekday numbers (0 = Sunday … 6 = Saturday). */
export type Weekend = number[];

export const branches = pgTable(
  "branches",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    address: jsonb("address").$type<LocalizedText>(),
    timezone: text("timezone").notNull().default("Asia/Riyadh"),
    weekend: jsonb("weekend").$type<Weekend>().notNull().default([5, 6]),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("branches_org_code_uq").on(t.organizationId, t.code)],
);

export const floors = pgTable(
  "floors",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("floors_branch_idx").on(t.branchId)],
);

/** A desk / counter / office where an agent serves visitors. `number` is what the display and voice announce. */
export const desks = pgTable(
  "desks",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    floorId: uuid("floor_id").references(() => floors.id),
    number: text("number").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    /** Zone label for multi-zone display layouts. */
    zone: text("zone"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("desks_branch_number_uq").on(t.branchId, t.number), index("desks_branch_idx").on(t.branchId)],
);
