CREATE TABLE IF NOT EXISTS "federated_graph_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "federated_graph_clients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_graph_persisted_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "federated_graph_persisted_operations_hash_unique" UNIQUE("hash"),
	CONSTRAINT "federated_graph_persisted_operations_file_path_unique" UNIQUE("file_path"),
	CONSTRAINT "federated_graph_operation_hash" UNIQUE("federated_graph_id","hash"),
	CONSTRAINT "federated_graph_operation_file_hash" UNIQUE("federated_graph_id","file_path")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_clients" ADD CONSTRAINT "federated_graph_clients_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_clients" ADD CONSTRAINT "federated_graph_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_clients" ADD CONSTRAINT "federated_graph_clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_persisted_operations_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_persisted_operations_client_id_federated_graph_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "federated_graph_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_persisted_operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_persisted_operations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
