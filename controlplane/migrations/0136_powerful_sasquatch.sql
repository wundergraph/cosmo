CREATE TABLE IF NOT EXISTS "schema_check_federated_graph_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_federated_graph_id" uuid NOT NULL,
	"schema_check_change_action_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schema_check_change_action" ADD COLUMN "is_fed_graph_change" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graph_changes" ADD CONSTRAINT "schema_check_federated_graph_changes_schema_check_federated_graph_id_schema_check_federated_graphs_id_fk" FOREIGN KEY ("schema_check_federated_graph_id") REFERENCES "public"."schema_check_federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graph_changes" ADD CONSTRAINT "schema_check_federated_graph_changes_schema_check_change_action_id_schema_check_change_action_id_fk" FOREIGN KEY ("schema_check_change_action_id") REFERENCES "public"."schema_check_change_action"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scfgsc_schema_check_federated_graph_id_idx" ON "schema_check_federated_graph_changes" USING btree ("schema_check_federated_graph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scfgsc_schema_check_change_action_id_idx" ON "schema_check_federated_graph_changes" USING btree ("schema_check_change_action_id");