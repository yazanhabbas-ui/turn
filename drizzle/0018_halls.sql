CREATE TYPE "public"."reason_delivery" AS ENUM('desk', 'hall');--> statement-breakpoint
CREATE TYPE "public"."hall_session_status" AS ENUM('OPEN', 'IN_SESSION', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hall_ticket_status" AS ENUM('CALLED', 'ENTERED', 'NO_SHOW', 'DONE', 'RELEASED');--> statement-breakpoint
CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"floor_id" uuid,
	"number" text NOT NULL,
	"name" jsonb NOT NULL,
	"capacity" integer DEFAULT 10 NOT NULL,
	"zone" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "halls_capacity_min" CHECK ("halls"."capacity" >= 2)
);
--> statement-breakpoint
CREATE TABLE "hall_reasons" (
	"hall_id" uuid NOT NULL,
	"reason_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_session_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"status" "hall_ticket_status" DEFAULT 'CALLED' NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entered_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "hall_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"hall_id" uuid NOT NULL,
	"host_agent_id" uuid NOT NULL,
	"status" "hall_session_status" DEFAULT 'OPEN' NOT NULL,
	"capacity" integer NOT NULL,
	"reason_id" uuid,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"outcome" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "current_hall_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "default_hall_id" uuid;--> statement-breakpoint
ALTER TABLE "visit_reasons" ADD COLUMN "delivery" "reason_delivery" DEFAULT 'desk' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "hall_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "hall_session_id" uuid;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_reasons" ADD CONSTRAINT "hall_reasons_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_reasons" ADD CONSTRAINT "hall_reasons_reason_id_visit_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."visit_reasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_session_tickets" ADD CONSTRAINT "hall_session_tickets_session_id_hall_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."hall_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_session_tickets" ADD CONSTRAINT "hall_session_tickets_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_sessions" ADD CONSTRAINT "hall_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_sessions" ADD CONSTRAINT "hall_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_sessions" ADD CONSTRAINT "hall_sessions_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_sessions" ADD CONSTRAINT "hall_sessions_host_agent_id_users_id_fk" FOREIGN KEY ("host_agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_sessions" ADD CONSTRAINT "hall_sessions_reason_id_visit_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."visit_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "halls_branch_number_uq" ON "halls" USING btree ("branch_id","number") WHERE "halls"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "halls_branch_idx" ON "halls" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_reasons_uq" ON "hall_reasons" USING btree ("hall_id","reason_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_session_tickets_uq" ON "hall_session_tickets" USING btree ("session_id","ticket_id");--> statement-breakpoint
CREATE INDEX "hall_session_tickets_ticket_idx" ON "hall_session_tickets" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_sessions_live_hall_uq" ON "hall_sessions" USING btree ("hall_id") WHERE "hall_sessions"."status" in ('OPEN','IN_SESSION');--> statement-breakpoint
CREATE UNIQUE INDEX "hall_sessions_live_host_uq" ON "hall_sessions" USING btree ("host_agent_id") WHERE "hall_sessions"."status" in ('OPEN','IN_SESSION');--> statement-breakpoint
CREATE INDEX "hall_sessions_branch_called_idx" ON "hall_sessions" USING btree ("branch_id","called_at");--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_current_hall_id_halls_id_fk" FOREIGN KEY ("current_hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_default_hall_id_halls_id_fk" FOREIGN KEY ("default_hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;
