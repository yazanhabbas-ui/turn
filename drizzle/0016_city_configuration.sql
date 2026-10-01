CREATE TABLE "city_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"reason_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_scope_key_uq";--> statement-breakpoint
DROP INDEX "message_templates_uq";--> statement-breakpoint
ALTER TABLE "brand_assets" ALTER COLUMN "version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "city_reasons" ADD CONSTRAINT "city_reasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_reasons" ADD CONSTRAINT "city_reasons_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_reasons" ADD CONSTRAINT "city_reasons_reason_id_visit_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."visit_reasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_reasons" ADD CONSTRAINT "city_reasons_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "city_reasons_city_reason_uq" ON "city_reasons" USING btree ("city_id","reason_id");--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_uq" UNIQUE NULLS NOT DISTINCT("organization_id","city_id","channel","event");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_scope_key_uq" UNIQUE NULLS NOT DISTINCT("organization_id","city_id","branch_id","key");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_one_scope_ck" CHECK ("settings"."city_id" is null or "settings"."branch_id" is null);