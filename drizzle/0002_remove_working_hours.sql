ALTER TABLE "visit_reasons" DROP COLUMN "schedule_id";--> statement-breakpoint
ALTER TABLE "visit_reasons" DROP COLUMN "cutoff_minutes";--> statement-breakpoint
DROP TABLE "schedule_rules" CASCADE;--> statement-breakpoint
DROP TABLE "schedules" CASCADE;
