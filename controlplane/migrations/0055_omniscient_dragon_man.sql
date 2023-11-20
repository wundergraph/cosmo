CREATE TABLE IF NOT EXISTS "graph_composition_subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_composition_id" uuid NOT NULL,
	"schema_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version_id" uuid NOT NULL,
	"is_composable" boolean DEFAULT false,
	"composition_errors" text,
	"router_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_graph_composition_id_graph_compositions_id_fk" FOREIGN KEY ("graph_composition_id") REFERENCES "graph_compositions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_compositions" ADD CONSTRAINT "graph_compositions_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_compositions" ADD CONSTRAINT "graph_compositions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
