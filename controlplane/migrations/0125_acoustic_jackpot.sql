CREATE TABLE IF NOT EXISTS "organization_invitation_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"group_id" uuid NOT NULL
);

-- Copy invitation groups to the new table
INSERT INTO "organization_invitation_groups"("invitation_id", "group_id")
    SELECT "id" as "invitation_id", "group_id"
    FROM "organization_invitations" "inv"
    WHERE "inv"."group_id" IS NOT NULL

--> statement-breakpoint
ALTER TABLE "organization_invitations" DROP CONSTRAINT "organization_invitations_group_id_organization_groups_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitation_groups" ADD CONSTRAINT "organization_invitation_groups_invitation_id_organization_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."organization_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitation_groups" ADD CONSTRAINT "organization_invitation_groups_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_inv_invitation_idx" ON "organization_invitation_groups" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_inv_group_id" ON "organization_invitation_groups" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "organization_invitations" DROP COLUMN IF EXISTS "group_id";