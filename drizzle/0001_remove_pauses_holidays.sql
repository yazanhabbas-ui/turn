DROP TABLE "holidays" CASCADE;--> statement-breakpoint
DROP TABLE "pause_windows" CASCADE;--> statement-breakpoint
ALTER TABLE "branches" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "branches" DROP COLUMN "longitude";--> statement-breakpoint
DELETE FROM "message_templates" WHERE "event" = 'prayer_pause';
