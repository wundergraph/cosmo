ALTER TABLE "schema_checks" ALTER COLUMN "target_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "target_type";