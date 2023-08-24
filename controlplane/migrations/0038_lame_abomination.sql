CREATE TABLE IF NOT EXISTS "organization_member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_member_id" uuid NOT NULL,
	"role" "member_role" NOT NULL
);
--> statement-breakpoint
DROP TABLE "member_roles";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_member_roles" ADD CONSTRAINT "organization_member_roles_organization_member_id_organization_members_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
