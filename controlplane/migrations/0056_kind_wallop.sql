ALTER TABLE "api_keys" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_versions" DROP COLUMN IF EXISTS "is_composable";--> statement-breakpoint
ALTER TABLE "schema_versions" DROP COLUMN IF EXISTS "composition_errors";--> statement-breakpoint
ALTER TABLE "schema_versions" DROP COLUMN IF EXISTS "router_config";