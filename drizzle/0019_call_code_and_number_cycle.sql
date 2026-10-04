DROP INDEX "tickets_branch_day_number_uq";--> statement-breakpoint
ALTER TABLE "ticket_counters" ADD COLUMN "cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "call_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_branch_day_number_uq" ON "tickets" USING btree ("branch_id","service_day","prefix","cycle","number");