ALTER TABLE "graph_compositions" ADD COLUMN "router_config_path" text;--> statement-breakpoint
-- Data migration to move the router_config_path from federated_graphs to graph_compositions
UPDATE "graph_compositions" SET "router_config_path" = "federated_graphs"."router_config_path" FROM "federated_graphs" WHERE "graph_compositions"."schema_version_id" = "federated_graphs"."composed_schema_version_id";--> statement-breakpoint
ALTER TABLE "federated_graphs" DROP COLUMN IF EXISTS "router_config_path";--> statement-breakpoint
ALTER TABLE "graph_compositions" DROP COLUMN IF EXISTS "router_config";