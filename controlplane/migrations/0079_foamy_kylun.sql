CREATE TABLE IF NOT EXISTS "operation_change_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"namespace_id" text NOT NULL,
	"change_type" "schema_change_type" NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operation_ignore_all_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"namespace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "schema_check_change_operation_usage" ADD COLUMN "federated_graph_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_change_operation_usage" ADD COLUMN "is_safe_override" boolean DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hash_change_idx" ON "operation_change_overrides" ("hash","namespace_id","change_type","path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hash_namespace_ignore_idx" ON "operation_ignore_all_overrides" ("hash","namespace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_change_operation_usage" ADD CONSTRAINT "schema_check_change_operation_usage_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_change_overrides" ADD CONSTRAINT "operation_change_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_ignore_all_overrides" ADD CONSTRAINT "operation_ignore_all_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
