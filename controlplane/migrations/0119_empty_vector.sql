ALTER TABLE "schema_checks" ADD COLUMN "composition_skipped" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "breaking_changes_skipped" boolean DEFAULT false;