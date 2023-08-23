ALTER TABLE "organization_members" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "accepted_invite" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organization_members" DROP COLUMN IF EXISTS "role";