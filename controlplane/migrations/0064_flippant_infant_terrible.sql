ALTER TABLE "organization_invitations" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
