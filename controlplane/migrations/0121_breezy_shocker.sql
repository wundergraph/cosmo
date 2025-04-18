CREATE TABLE IF NOT EXISTS "organization_rule_set_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_rule_set_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"resource" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kc_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_rule_sets_kc_group_id_unique" UNIQUE("kc_group_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_rule_set_members" ADD CONSTRAINT "organization_rule_set_members_rule_set_id_organization_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."organization_rule_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_rule_set_rules" ADD CONSTRAINT "organization_rule_set_rules_rule_set_id_organization_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."organization_rule_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_rule_sets" ADD CONSTRAINT "organization_rule_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
