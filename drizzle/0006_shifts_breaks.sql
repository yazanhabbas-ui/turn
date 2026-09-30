CREATE TABLE "break_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"break_type_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Damascus';--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "break_requests_branch_status_idx" ON "break_requests" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "break_requests_user_idx" ON "break_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_org_code_uq" ON "shifts" USING btree ("organization_id","code");--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every organization starts with a morning and an evening shift (edit them in Admin → Settings → Agents).
INSERT INTO "shifts" ("organization_id", "code", "name", "starts_at", "ends_at", "sort_order")
SELECT o."id", 'morning', '{"ar": "صباحي", "en": "Morning"}'::jsonb, '08:00', '15:00', 0 FROM "organizations" o;
--> statement-breakpoint
INSERT INTO "shifts" ("organization_id", "code", "name", "starts_at", "ends_at", "sort_order")
SELECT o."id", 'evening', '{"ar": "مسائي", "en": "Evening"}'::jsonb, '15:00', '22:00', 1 FROM "organizations" o;
