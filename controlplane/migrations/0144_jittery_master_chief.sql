CREATE TABLE IF NOT EXISTS "slack_proposal_state_update" (
	"slack_integration_config_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	CONSTRAINT "slack_proposal_state_update_slack_integration_config_id_federated_graph_id_pk" PRIMARY KEY("slack_integration_config_id","federated_graph_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_proposal_state_update" ADD CONSTRAINT "slack_proposal_state_update_slack_integration_config_id_slack_integration_configs_id_fk" FOREIGN KEY ("slack_integration_config_id") REFERENCES "public"."slack_integration_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_proposal_state_update" ADD CONSTRAINT "slack_proposal_state_update_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slackpsu_slack_integration_config_id_idx" ON "slack_proposal_state_update" USING btree ("slack_integration_config_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slackpsu_federated_graph_id_idx" ON "slack_proposal_state_update" USING btree ("federated_graph_id");