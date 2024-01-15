DO $$ BEGIN
 CREATE TYPE "audit_action" AS ENUM('created', 'updated', 'deleted', 'accepted', 'declined');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "audit_actor_type" AS ENUM('user', 'system', 'api_key');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "audit_full_action" AS ENUM('organization.created', 'organization.updated', 'graph_token.created', 'graph_token.deleted', 'federated_graph.created', 'federated_graph.deleted', 'federated_graph.updated', 'subgraph.created', 'subgraph.deleted', 'subgraph.updated', 'subgraph_member.created', 'subgraph_member.deleted', 'webhook_config.created', 'webhook_config.deleted', 'webhook_config.updated', 'organization_details.updated', 'integration.created', 'integration.deleted', 'integration.updated', 'api_key.created', 'api_key.deleted', 'organization_invitation.created', 'organization_invitation.accepted', 'organization_invitation.declined', 'organization_invitation.deleted', 'organization_member.deleted', 'member_role.updated');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "audit_target_type" AS ENUM('organization', 'subgraph', 'federated_graph');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "auditable_type" AS ENUM('organization', 'subgraph', 'federated_graph', 'graph_token', 'api_key', 'webhook_config', 'integration');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"audit_action" "audit_full_action" NOT NULL,
	"auditable_type" "auditable_type",
	"auditable_display_name" text,
	"target_id" uuid,
	"target_type" "audit_target_type",
	"target_display_name" text,
	"actor_id" uuid,
	"actor_display_name" text,
	"actor_type" "audit_actor_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "federated_subgraphs" DROP CONSTRAINT "federated_subgraphs_federated_graph_id_subgraph_id";--> statement-breakpoint
ALTER TABLE "webhook_graph_schema_update" DROP CONSTRAINT "webhook_graph_schema_update_webhook_id_federated_graph_id";--> statement-breakpoint
ALTER TABLE "federated_subgraphs" ADD CONSTRAINT "federated_subgraphs_federated_graph_id_subgraph_id_pk" PRIMARY KEY("federated_graph_id","subgraph_id");--> statement-breakpoint
ALTER TABLE "webhook_graph_schema_update" ADD CONSTRAINT "webhook_graph_schema_update_webhook_id_federated_graph_id_pk" PRIMARY KEY("webhook_id","federated_graph_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
