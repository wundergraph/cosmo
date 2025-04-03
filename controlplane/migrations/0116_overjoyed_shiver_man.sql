ALTER TABLE "organizations" ADD COLUMN "queued_for_deletion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "queued_for_deletion_by" text;