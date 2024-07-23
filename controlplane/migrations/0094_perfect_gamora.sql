ALTER TABLE "organizations" ADD COLUMN "is_deactivated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deactivation_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deactivated_at" timestamp with time zone;