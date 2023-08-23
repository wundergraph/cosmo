ALTER TABLE "schema_versions" ALTER COLUMN "is_composable" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_versions" ADD COLUMN "composition_errors" text;