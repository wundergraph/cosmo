ALTER TABLE "federated_graphs_to_feature_flag_schema_versions" ADD COLUMN "feature_flag_id" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs_to_feature_flag_schema_versions" ADD CONSTRAINT "federated_graphs_to_feature_flag_schema_versions_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "feature_flags"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
