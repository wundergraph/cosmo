CREATE TABLE IF NOT EXISTS "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_federated_graph_id" uuid NOT NULL,
	"downstream_federated_graph_id" uuid NOT NULL,
	"exclude_tags" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "federated_graph_source_downstream_id" UNIQUE("source_federated_graph_id","downstream_federated_graph_id")
);
--> statement-breakpoint
ALTER TABLE "schema_check_composition" ADD COLUMN "client_schema" text;--> statement-breakpoint
ALTER TABLE "schema_versions" ADD COLUMN "client_schema" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_source_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("source_federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_downstream_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("downstream_federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
