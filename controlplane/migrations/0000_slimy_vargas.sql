DO $$ BEGIN
 CREATE TYPE "change_type" AS ENUM('add_field', 'remove_field', 'renamed_field');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "target_type" AS ENUM('federated', 'subgraph', 'graph');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid,
	"schema_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid,
	"supergraph_sdl" text,
	"schema_sdl" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_version_change_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version_id" uuid,
	"change_type" "change_type",
	"change_description" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_version_changelog" (
	"schema_version_id" uuid NOT NULL,
	"schema_version_change_action_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routing_url" text,
	"target_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_subgraphs" (
	"federated_graph_id" uuid NOT NULL,
	"subgraph_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "target_labels" (
	"target_id" uuid NOT NULL,
	"key" text,
	"value" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "target_type",
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "name_idx" ON "targets" ("name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs" ADD CONSTRAINT "federated_graphs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs" ADD CONSTRAINT "federated_graphs_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_versions" ADD CONSTRAINT "schema_versions_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_version_change_action" ADD CONSTRAINT "schema_version_change_action_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_version_changelog" ADD CONSTRAINT "schema_version_changelog_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_version_changelog" ADD CONSTRAINT "schema_version_changelog_schema_version_change_action_id_schema_version_change_action_id_fk" FOREIGN KEY ("schema_version_change_action_id") REFERENCES "schema_version_change_action"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_subgraphs" ADD CONSTRAINT "federated_subgraphs_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_subgraphs" ADD CONSTRAINT "federated_subgraphs_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "target_labels" ADD CONSTRAINT "target_labels_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
