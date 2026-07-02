DROP INDEX IF EXISTS "scc_check_target_flag_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "scfgc_fed_graph_change_action_unique";--> statement-breakpoint
ALTER TABLE "schema_check_composition" ADD CONSTRAINT "scc_check_target_flag_unique" UNIQUE NULLS NOT DISTINCT("schema_check_id","target_id","feature_flag_id");--> statement-breakpoint
ALTER TABLE "schema_check_federated_graph_changes" ADD CONSTRAINT "scfgc_fed_graph_change_action_unique" UNIQUE NULLS NOT DISTINCT("schema_check_federated_graph_id","schema_check_change_action_id","feature_flag_id");