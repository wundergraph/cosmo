ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "is_composable";--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "has_breaking_changes";--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "has_graph_pruning_errors";--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "has_client_traffic";