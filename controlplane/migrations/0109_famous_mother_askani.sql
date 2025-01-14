CREATE TABLE IF NOT EXISTS "cache_warmer_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"operation_content" text,
	"operation_hash" text,
	"operation_persisted_id" text,
	"operation_name" text,
	"client_name" text,
	"client_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planning_time" real,
	"is_manually_added" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "enable_cache_warming" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cache_warmer_operations" ADD CONSTRAINT "cache_warmer_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cache_warmer_operations" ADD CONSTRAINT "cache_warmer_operations_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cache_warmer_operations" ADD CONSTRAINT "cache_warmer_operations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cwo_organization_id_idx" ON "cache_warmer_operations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cwo_federated_graph_id_idx" ON "cache_warmer_operations" USING btree ("federated_graph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cwo_created_by_id_idx" ON "cache_warmer_operations" USING btree ("created_by_id");