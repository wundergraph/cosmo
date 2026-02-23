CREATE TABLE IF NOT EXISTS "schema_check_federated_graph_schema_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_federated_graph_id" uuid NOT NULL,
	"change_type" "schema_change_type",
	"change_message" text,
	"is_breaking" boolean DEFAULT false,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graph_schema_changes" ADD CONSTRAINT "schema_check_federated_graph_schema_changes_schema_check_federated_graph_id_schema_check_federated_graphs_id_fk" FOREIGN KEY ("schema_check_federated_graph_id") REFERENCES "public"."schema_check_federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scfgsc_schema_check_federated_graph_id_idx" ON "schema_check_federated_graph_schema_changes" USING btree ("schema_check_federated_graph_id");