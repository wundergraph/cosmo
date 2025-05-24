CREATE TYPE "public"."organization_role" AS ENUM('organization-admin', 'organization-developer', 'organization-viewer', 'organization-apikey-manager', 'namespace-admin', 'namespace-viewer', 'graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-publisher');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_member_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_rule_namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"namespace_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_rule_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"target_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "organization_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"builtin" boolean NOT NULL,
	"kc_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_groups_kc_group_id_unique" UNIQUE("kc_group_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kc_group_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_organization_member_id_organization_members_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_rule_namespaces" ADD CONSTRAINT "organization_group_rule_namespaces_rule_id_organization_group_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."organization_group_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_rule_namespaces" ADD CONSTRAINT "organization_group_rule_namespaces_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_rule_targets" ADD CONSTRAINT "organization_group_rule_targets_rule_id_organization_group_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."organization_group_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_rule_targets" ADD CONSTRAINT "organization_group_rule_targets_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_rules" ADD CONSTRAINT "organization_group_rules_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_groups" ADD CONSTRAINT "organization_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_member_group_idx" ON "organization_group_members" USING btree ("organization_member_id","group_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kc_group_id_unique" UNIQUE("kc_group_id");