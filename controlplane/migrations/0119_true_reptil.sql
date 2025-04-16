CREATE TABLE IF NOT EXISTS "webhook_proposal_state_update" (
	"webhook_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	CONSTRAINT "webhook_proposal_state_update_webhook_id_federated_graph_id_pk" PRIMARY KEY("webhook_id","federated_graph_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_proposal_state_update" ADD CONSTRAINT "webhook_proposal_state_update_webhook_id_organization_webhook_configs_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."organization_webhook_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_proposal_state_update" ADD CONSTRAINT "webhook_proposal_state_update_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wpsu_webhook_id_idx" ON "webhook_proposal_state_update" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wpsu_federated_graph_id_idx" ON "webhook_proposal_state_update" USING btree ("federated_graph_id");