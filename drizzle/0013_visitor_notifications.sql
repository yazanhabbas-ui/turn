ALTER TABLE "visitors" ADD COLUMN "notifications_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "notifications_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_log_dedupe_uq" ON "notifications_log" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_log_due_idx" ON "notifications_log" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_log_ticket_idx" ON "notifications_log" USING btree ("ticket_id");
