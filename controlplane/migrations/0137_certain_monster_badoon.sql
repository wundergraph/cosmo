CREATE INDEX IF NOT EXISTS "scca_schema_check_subgraph_id_idx" ON "schema_check_change_action" USING btree ("schema_check_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scgpa_schema_check_subgraph_id_idx" ON "schema_check_graph_pruning_action" USING btree ("schema_check_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sclact_schema_check_subgraph_id_idx" ON "schema_check_lint_action" USING btree ("schema_check_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scs_namespace_id_idx" ON "schema_check_subgraphs" USING btree ("namespace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sce_webhook_delivery_id_idx" ON "schema_checks" USING btree ("check_extension_delivery_id");