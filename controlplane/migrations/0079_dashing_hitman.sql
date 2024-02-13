CREATE TABLE IF NOT EXISTS "operation_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"namespace_id" text NOT NULL,
	"ignore_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "schema_check_change_operation_usage" ADD COLUMN "federated_graph_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_change_operation_usage" ADD COLUMN "is_safe_override" boolean DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hash_check_idx" ON "operation_overrides" ("hash","schema_check_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_change_operation_usage" ADD CONSTRAINT "schema_check_change_operation_usage_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_overrides" ADD CONSTRAINT "operation_overrides_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_overrides" ADD CONSTRAINT "operation_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_overrides" ADD CONSTRAINT "operation_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
