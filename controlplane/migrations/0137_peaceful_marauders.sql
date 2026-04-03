CREATE TABLE IF NOT EXISTS "persisted_operation_to_feature_flags" (
	"persisted_operation_id" uuid NOT NULL,
	"feature_flag_id" uuid NOT NULL,
	CONSTRAINT "persisted_operation_to_feature_flags_persisted_operation_id_feature_flag_id_pk" PRIMARY KEY("persisted_operation_id","feature_flag_id")
);
--> statement-breakpoint
ALTER TABLE "federated_graph_persisted_operations" ADD COLUMN "valid_on_base_graph" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persisted_operation_to_feature_flags" ADD CONSTRAINT "persisted_operation_to_feature_flags_persisted_operation_id_federated_graph_persisted_operations_id_fk" FOREIGN KEY ("persisted_operation_id") REFERENCES "public"."federated_graph_persisted_operations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persisted_operation_to_feature_flags" ADD CONSTRAINT "persisted_operation_to_feature_flags_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
