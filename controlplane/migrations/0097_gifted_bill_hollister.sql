DO $$ BEGIN
 CREATE TYPE "public"."graph_pruning_rules" AS ENUM('UNUSED_FIELDS', 'DEPRECATED_FIELDS', 'REQUIRE_DEPRECATION_BEFORE_DELETION');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_grace_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subgraph_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"namespace_id" uuid NOT NULL,
	"path" text,
	"expires_at" timestamp with time zone NOT NULL,
	"is_deprecated" boolean
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "namespace_graph_pruning_check_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"graph_pruning_rule" "graph_pruning_rules" NOT NULL,
	"severity_level" "lint_severity" NOT NULL,
	"grace_period" integer NOT NULL,
	"scheme_usage_check_period" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_graph_pruning_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"graph_pruning_rule" "graph_pruning_rules" NOT NULL,
	"field_path" text NOT NULL,
	"message" text,
	"is_error" boolean DEFAULT false,
	"location" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"federated_graph_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "enable_graph_pruning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "has_graph_pruning_errors" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_grace_period" ADD CONSTRAINT "field_grace_period_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_grace_period" ADD CONSTRAINT "field_grace_period_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_grace_period" ADD CONSTRAINT "field_grace_period_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_graph_pruning_check_config" ADD CONSTRAINT "namespace_graph_pruning_check_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_graph_pruning_action" ADD CONSTRAINT "schema_check_graph_pruning_action_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_graph_pruning_action" ADD CONSTRAINT "schema_check_graph_pruning_action_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_field_grace_period_idx" ON "field_grace_period" USING btree ("subgraph_id","namespace_id","organization_id","path","is_deprecated");