CREATE TABLE IF NOT EXISTS "graph_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_schema_version_id" uuid NOT NULL,
	"subgraph_schema_version_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_compositions" ADD CONSTRAINT "graph_compositions_federated_graph_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("federated_graph_schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_compositions" ADD CONSTRAINT "graph_compositions_subgraph_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("subgraph_schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
