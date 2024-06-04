CREATE TABLE IF NOT EXISTS "feature_flags_group_to_feature_flags" (
	"feature_flag_group_id" uuid NOT NULL,
	"feature_flag_id" uuid NOT NULL,
	CONSTRAINT "feature_flags_group_to_feature_flags_feature_flag_id_feature_flag_group_id_pk" PRIMARY KEY("feature_flag_id","feature_flag_group_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flag_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"namespace_id" uuid NOT NULL,
	"labels" text[],
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags_subgraphs" (
	"feature_flag_id" uuid NOT NULL,
	"base_subgraph_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "feature_flags_subgraphs_feature_flag_id_base_subgraph_id_pk" PRIMARY KEY("feature_flag_id","base_subgraph_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_graphs_to_ff_schema_versions" (
	"federated_graph_id" uuid NOT NULL,
	"base_composition_schema_version_id" uuid NOT NULL,
	"composed_schema_version_id" uuid NOT NULL,
	CONSTRAINT "federated_graphs_to_ff_schema_versions_federated_graph_id_base_composition_schema_version_id_composed_schema_version_id_pk" PRIMARY KEY("federated_graph_id","base_composition_schema_version_id","composed_schema_version_id")
);
--> statement-breakpoint
ALTER TABLE "subgraphs" ADD COLUMN "is_feature_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags_group_to_feature_flags" ADD CONSTRAINT "feature_flags_group_to_feature_flags_feature_flag_group_id_feature_flag_groups_id_fk" FOREIGN KEY ("feature_flag_group_id") REFERENCES "feature_flag_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags_group_to_feature_flags" ADD CONSTRAINT "feature_flags_group_to_feature_flags_feature_flag_id_subgraphs_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flag_groups" ADD CONSTRAINT "feature_flag_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flag_groups" ADD CONSTRAINT "feature_flag_groups_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flag_groups" ADD CONSTRAINT "feature_flag_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags_subgraphs" ADD CONSTRAINT "feature_flags_subgraphs_feature_flag_id_subgraphs_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags_subgraphs" ADD CONSTRAINT "feature_flags_subgraphs_base_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("base_subgraph_id") REFERENCES "subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs_to_ff_schema_versions" ADD CONSTRAINT "federated_graphs_to_ff_schema_versions_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs_to_ff_schema_versions" ADD CONSTRAINT "federated_graphs_to_ff_schema_versions_base_composition_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("base_composition_schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs_to_ff_schema_versions" ADD CONSTRAINT "federated_graphs_to_ff_schema_versions_composed_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("composed_schema_version_id") REFERENCES "schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
