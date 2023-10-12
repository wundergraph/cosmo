CREATE TABLE IF NOT EXISTS "slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slack_organization_id" text NOT NULL,
	"slack_organization_name" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_channel_name" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slack_installations_idx" ON "slack_installations" ("organization_id","slack_organization_id","slack_channel_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
