ALTER TABLE "targets" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_schema_update_event_configs" ADD CONSTRAINT "slack_schema_update_event_configs_slack_integration_config_id_federated_graph_id_pk" PRIMARY KEY("slack_integration_config_id","federated_graph_id");--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "as_monograph" boolean DEFAULT false NOT NULL;