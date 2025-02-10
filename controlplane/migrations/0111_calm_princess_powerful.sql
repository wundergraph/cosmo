ALTER TABLE "schema_check_change_action" ADD COLUMN "federated_graph_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "is_composable" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "has_breaking_changes" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "has_lint_errors" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "has_graph_pruning_errors" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "has_client_traffic" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_change_action" ADD CONSTRAINT "schema_check_change_action_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scca_federated_graph_id_idx" ON "schema_check_change_action" USING btree ("federated_graph_id");