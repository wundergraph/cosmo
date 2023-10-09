DO $$ BEGIN
 CREATE TYPE "integration_type" AS ENUM('slack');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"events" text[],
	"type" "integration_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_event_graph_ids" (
	"slack_integration_event_config_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_integration_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"endpoint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_integration_event_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_integration_config_id" uuid NOT NULL,
	"event" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_integration_idx" ON "organization_integrations" ("organization_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_event_graph_ids" ADD CONSTRAINT "slack_event_graph_ids_slack_integration_event_config_id_slack_integration_event_configs_id_fk" FOREIGN KEY ("slack_integration_event_config_id") REFERENCES "slack_integration_event_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_event_graph_ids" ADD CONSTRAINT "slack_event_graph_ids_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_integration_configs" ADD CONSTRAINT "slack_integration_configs_integration_id_organization_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "organization_integrations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_integration_event_configs" ADD CONSTRAINT "slack_integration_event_configs_slack_integration_config_id_slack_integration_configs_id_fk" FOREIGN KEY ("slack_integration_config_id") REFERENCES "slack_integration_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
