CREATE TYPE "public"."graph_resource_kind" AS ENUM('subgraph', 'type', 'override');--> statement-breakpoint
CREATE TYPE "public"."hub_permission" AS ENUM('create_sandbox', 'share_sandbox', 'edit_sandbox', 'propose', 'approve', 'run_agents', 'open_portals', 'approve_egress', 'manage_egress_credentials', 'manage_integrations', 'view_audit_log');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_resource_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"resource_kind" "graph_resource_kind" NOT NULL,
	"resource" text NOT NULL,
	"group_id" uuid,
	"organization_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gro_group_xor_member_check" CHECK (("graph_resource_owners"."group_id" IS NOT NULL) <> ("graph_resource_owners"."organization_member_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_hub_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"permission" "hub_permission" NOT NULL,
	"namespace_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"target_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_resource_owners" ADD CONSTRAINT "graph_resource_owners_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_resource_owners" ADD CONSTRAINT "graph_resource_owners_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_resource_owners" ADD CONSTRAINT "graph_resource_owners_organization_member_id_organization_members_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_hub_permissions" ADD CONSTRAINT "organization_group_hub_permissions_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gro_federated_graph_id_idx" ON "graph_resource_owners" USING btree ("federated_graph_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oghp_group_permission_idx" ON "organization_group_hub_permissions" USING btree ("group_id","permission");