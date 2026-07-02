DROP INDEX IF EXISTS "scfgc_fed_graph_change_action_unique";--> statement-breakpoint
ALTER TABLE "schema_check_composition" ADD COLUMN "feature_flag_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graph_changes" ADD COLUMN "feature_flag_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_subgraphs" ADD COLUMN "is_feature_subgraph" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_composition" ADD CONSTRAINT "schema_check_composition_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graph_changes" ADD CONSTRAINT "schema_check_federated_graph_changes_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scc_feature_flag_id_idx" ON "schema_check_composition" USING btree ("feature_flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scc_check_target_flag_unique" ON "schema_check_composition" USING btree ("schema_check_id","target_id","feature_flag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scfgc_feature_flag_id_idx" ON "schema_check_federated_graph_changes" USING btree ("feature_flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scfgc_fed_graph_change_action_unique" ON "schema_check_federated_graph_changes" USING btree ("schema_check_federated_graph_id","schema_check_change_action_id","feature_flag_id");