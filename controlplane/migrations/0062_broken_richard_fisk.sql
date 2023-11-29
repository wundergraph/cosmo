CREATE TABLE IF NOT EXISTS "graph_csrf_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_csrf_keys_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_csrf_keys" ADD CONSTRAINT "graph_csrf_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_csrf_keys" ADD CONSTRAINT "graph_csrf_keys_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create default graph csrf keys for federated graphs
INSERT INTO graph_csrf_keys SELECT gen_random_uuid(), targets.organization_id, federated_graphs.id, MD5(random()::text), now()
FROM targets INNER JOIN federated_graphs ON federated_graphs.target_id = targets.id WHERE type = 'federated';