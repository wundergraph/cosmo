CREATE TABLE IF NOT EXISTS "webhook_graph_schema_update" (
	"webhook_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	CONSTRAINT webhook_graph_schema_update_webhook_id_federated_graph_id PRIMARY KEY("webhook_id","federated_graph_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_graph_schema_update" ADD CONSTRAINT "webhook_graph_schema_update_webhook_id_organization_webhook_configs_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "organization_webhook_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_graph_schema_update" ADD CONSTRAINT "webhook_graph_schema_update_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
