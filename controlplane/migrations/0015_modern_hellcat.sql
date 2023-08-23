DROP TABLE "schema_version_changelog";--> statement-breakpoint
ALTER TABLE "schema_version_change_action" ALTER COLUMN "schema_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_version_change_action" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "schema_version_change_action" DROP COLUMN IF EXISTS "change_type";--> statement-breakpoint
ALTER TABLE "schema_version_change_action" DROP COLUMN IF EXISTS "change_description";