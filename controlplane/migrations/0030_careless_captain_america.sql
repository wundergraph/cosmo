ALTER TABLE "graph_api_tokens" DROP CONSTRAINT "graph_api_tokens_federated_graph_id_federated_graphs_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_api_tokens" ADD CONSTRAINT "graph_api_tokens_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
