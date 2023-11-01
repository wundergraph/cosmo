CREATE TABLE IF NOT EXISTS "federated_graph_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"traffic_check_days" integer DEFAULT 7 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_change_operation_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_change_action_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "has_client_traffic" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_configs" ADD CONSTRAINT "federated_graph_configs_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_change_operation_usage" ADD CONSTRAINT "schema_check_change_operation_usage_schema_check_change_action_id_schema_check_change_action_id_fk" FOREIGN KEY ("schema_check_change_action_id") REFERENCES "schema_check_change_action"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
