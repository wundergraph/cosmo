ALTER TABLE "organization_limits" ADD COLUMN "users" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_limits" ADD COLUMN "graphs" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;