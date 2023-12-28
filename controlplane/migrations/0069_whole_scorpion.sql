DO $$ BEGIN
 CREATE TYPE "status" AS ENUM('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"features" json NOT NULL,
	"stripe_price_id" text,
	"weight" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"metadata" json NOT NULL,
	"status" "status" NOT NULL,
	"price_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_billing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan" text,
	"email" text,
	"stripe_customer_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"limit" integer
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "is_personal" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "is_free_trial" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "is_rbac_enabled" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "is_rbac_enabled" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_billing_idx" ON "organization_billing" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_billing_stripe_idx" ON "organization_billing" ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_feature_idx" ON "organization_features" ("organization_id","feature");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_features" ADD CONSTRAINT "organization_features_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
