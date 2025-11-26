ALTER TABLE "organization_invitations" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "active" boolean DEFAULT true NOT NULL;