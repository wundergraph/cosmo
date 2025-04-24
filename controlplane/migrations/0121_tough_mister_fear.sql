CREATE TABLE IF NOT EXISTS "organization_member_group_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"resource" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_member_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kc_group_id" text,
	"kc_mapper_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_groups_kc_group_id_unique" UNIQUE("kc_group_id"),
	CONSTRAINT "organization_member_groups_kc_mapper_id_unique" UNIQUE("kc_mapper_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_member_group_rules" ADD CONSTRAINT "organization_member_group_rules_group_id_organization_member_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_member_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_member_groups" ADD CONSTRAINT "organization_member_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
