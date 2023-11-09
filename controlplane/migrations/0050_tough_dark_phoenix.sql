ALTER TYPE "member_role" ADD VALUE 'viewer';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_member_role_idx" ON "organization_member_roles" ("organization_member_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_organization_member_idx" ON "organization_members" ("user_id","organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
