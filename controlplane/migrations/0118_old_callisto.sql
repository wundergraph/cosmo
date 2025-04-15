CREATE TYPE "public"."proposal_match" AS ENUM('success', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('DRAFT', 'APPROVED', 'PUBLISHED', 'CLOSED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "namespace_proposal_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"check_severity_level" "lint_severity" NOT NULL,
	"publish_severity_level" "lint_severity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npc_namespace_id_idx" UNIQUE("namespace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"subgraph_id" uuid,
	"subgraph_name" text NOT NULL,
	"schema_sdl" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"is_published" boolean DEFAULT false NOT NULL,
	"current_schema_version_id" uuid,
	"labels" text[],
	CONSTRAINT "proposal_subgraph" UNIQUE("proposal_id","subgraph_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"state" "proposal_state" NOT NULL,
	CONSTRAINT "federated_graph_proposal_name" UNIQUE("federated_graph_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_proposal_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_match" boolean NOT NULL,
	CONSTRAINT "unique_schema_check_proposal_match" UNIQUE("schema_check_id","proposal_id")
);
--> statement-breakpoint
ALTER TABLE "namespace_config" ADD COLUMN "enable_proposals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "proposal_match" "proposal_match";--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "composition_skipped" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "breaking_changes_skipped" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "error_message" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_proposal_config" ADD CONSTRAINT "namespace_proposal_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_checks" ADD CONSTRAINT "proposal_checks_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_checks" ADD CONSTRAINT "proposal_checks_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraphs_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraphs_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraphs_current_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("current_schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposal_match" ADD CONSTRAINT "schema_check_proposal_match_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposal_match" ADD CONSTRAINT "schema_check_proposal_match_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pc_check_id_proposal_id_idx" ON "proposal_checks" USING btree ("schema_check_id","proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pr_created_by_id_idx" ON "proposals" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scpm_schema_check_id_idx" ON "schema_check_proposal_match" USING btree ("schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scpm_proposal_id_idx" ON "schema_check_proposal_match" USING btree ("proposal_id");