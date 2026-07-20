ALTER TABLE "schema_check_composition" DROP CONSTRAINT "schema_check_composition_feature_flag_id_feature_flags_id_fk";
--> statement-breakpoint
ALTER TABLE "schema_check_federated_graph_changes" DROP CONSTRAINT "schema_check_federated_graph_changes_feature_flag_id_feature_flags_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_composition" ADD CONSTRAINT "schema_check_composition_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graph_changes" ADD CONSTRAINT "schema_check_federated_graph_changes_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
