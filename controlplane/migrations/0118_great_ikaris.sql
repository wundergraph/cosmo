CREATE TABLE IF NOT EXISTS "schema_check_subgraphs_federated_graphs" (
	"schema_check_federated_graph_id" uuid,
	"schema_check_subgraph_id" uuid
);
--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs_federated_graphs" ADD CONSTRAINT "schema_check_subgraphs_federated_graphs_schema_check_federated_graph_id_schema_check_federated_graphs_id_fk" FOREIGN KEY ("schema_check_federated_graph_id") REFERENCES "public"."schema_check_federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs_federated_graphs" ADD CONSTRAINT "schema_check_subgraphs_federated_graphs_schema_check_subgraph_id_schema_check_subgraphs_id_fk" FOREIGN KEY ("schema_check_subgraph_id") REFERENCES "public"."schema_check_subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scsfg_schema_check_subgraph_id_idx" ON "schema_check_subgraphs_federated_graphs" USING btree ("schema_check_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scsfg_schema_check_federated_graph_id_idx" ON "schema_check_subgraphs_federated_graphs" USING btree ("schema_check_federated_graph_id");