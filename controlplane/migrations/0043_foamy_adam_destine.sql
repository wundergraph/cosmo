DO $$ BEGIN
 CREATE TYPE "git_installation_type" AS ENUM('PERSONAL', 'ORGANIZATION');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "git_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"type" "git_installation_type" NOT NULL,
	"provider_account_id" bigint NOT NULL,
	"provider_installation_id" bigint NOT NULL,
	"provider_name" text NOT NULL,
	"oauth_token" text
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "gh_details" json;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "forced_success" boolean DEFAULT false;