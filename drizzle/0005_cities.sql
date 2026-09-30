CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_uq";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_org_code_uq" ON "cities" USING btree ("organization_id","code");--> statement-breakpoint
-- Existing branches move into one starter city per organization (rename it in Admin → Cities).
INSERT INTO "cities" ("organization_id", "code", "name")
SELECT DISTINCT o."id", 'main', '{"ar": "المدينة الرئيسية", "en": "Main city"}'::jsonb
FROM "organizations" o;--> statement-breakpoint
UPDATE "branches" b SET "city_id" = c."id" FROM "cities" c WHERE c."organization_id" = b."organization_id" AND c."code" = 'main';--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "city_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branches_city_idx" ON "branches" USING btree ("city_id");--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_uq" UNIQUE NULLS NOT DISTINCT("user_id","role_id","branch_id","city_id");--> statement-breakpoint
-- A grant is for a branch or for a city, never both.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_chk" CHECK ("branch_id" IS NULL OR "city_id" IS NULL);
