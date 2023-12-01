CREATE TABLE IF NOT EXISTS "graph_request_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"privateKey" text NOT NULL,
	"publicKey" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_request_keys_federated_graph_id_unique" UNIQUE("federated_graph_id"),
	CONSTRAINT "graph_request_keys_privateKey_unique" UNIQUE("privateKey"),
	CONSTRAINT "graph_request_keys_publicKey_unique" UNIQUE("publicKey")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_request_keys" ADD CONSTRAINT "graph_request_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_request_keys" ADD CONSTRAINT "graph_request_keys_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
