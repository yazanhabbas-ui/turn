ALTER TABLE "agent_profiles" ALTER COLUMN "max_concurrent" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent_profiles" ALTER COLUMN "max_concurrent" DROP NOT NULL;--> statement-breakpoint
UPDATE "agent_profiles" SET "max_concurrent" = NULL WHERE "max_concurrent" = 1;
