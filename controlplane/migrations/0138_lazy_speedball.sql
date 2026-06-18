CREATE TABLE IF NOT EXISTS "router_config_hash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"feature_flag_id" uuid,
	"hash" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "fed_graph_feature_flag_idx" UNIQUE NULLS NOT DISTINCT("federated_graph_id","feature_flag_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "router_config_hash" ADD CONSTRAINT "router_config_hash_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "router_config_hash" ADD CONSTRAINT "router_config_hash_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "onboarding" DROP COLUMN IF EXISTS "updated_at";