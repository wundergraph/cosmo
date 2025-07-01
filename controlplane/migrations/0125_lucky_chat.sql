CREATE TABLE IF NOT EXISTS "federated_graph_collection_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"operation_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"operation_content" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "federated_graph_collection_operations_file_path_unique" UNIQUE("file_path"),
	CONSTRAINT "federated_graph_collection_operation_name" UNIQUE("collection_id","operation_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_graph_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "federated_graph_collection_name" UNIQUE("federated_graph_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collection_operations" ADD CONSTRAINT "federated_graph_collection_operations_collection_id_federated_graph_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."federated_graph_collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collection_operations" ADD CONSTRAINT "federated_graph_collection_operations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collection_operations" ADD CONSTRAINT "federated_graph_collection_operations_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collections" ADD CONSTRAINT "federated_graph_collections_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collections" ADD CONSTRAINT "federated_graph_collections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collections" ADD CONSTRAINT "federated_graph_collections_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgcoo_created_by_id_idx" ON "federated_graph_collection_operations" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgcoo_updated_by_id_idx" ON "federated_graph_collection_operations" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgcoo_collection_id_idx" ON "federated_graph_collection_operations" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgco_created_by_id_idx" ON "federated_graph_collections" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgco_updated_by_id_idx" ON "federated_graph_collections" USING btree ("updated_by_id");