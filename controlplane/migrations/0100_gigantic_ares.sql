ALTER TABLE "schema_checks" ADD COLUMN "lint_skipped" boolean;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "graph_pruning_skipped" boolean;--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "client_traffic_ignored";