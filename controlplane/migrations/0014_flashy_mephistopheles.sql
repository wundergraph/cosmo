ALTER TABLE "schema_check_change_action" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_check_composition" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_versions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_version_change_action" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "created_at" SET NOT NULL;