CREATE TYPE "public"."ci_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ci_trusted_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "ci_provider" NOT NULL,
	"issuer" text NOT NULL,
	"repository" text NOT NULL,
	"ref_filter" text,
	"group_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "external_link" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ci_trusted_repositories" ADD CONSTRAINT "ci_trusted_repositories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ci_trusted_repositories" ADD CONSTRAINT "ci_trusted_repositories_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ci_trusted_repositories" ADD CONSTRAINT "ci_trusted_repositories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "citr_organization_issuer_repository_idx" ON "ci_trusted_repositories" USING btree ("organization_id","issuer","repository");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "citr_issuer_repository_idx" ON "ci_trusted_repositories" USING btree ("issuer","repository");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "citr_group_id_idx" ON "ci_trusted_repositories" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "citr_created_by_id_idx" ON "ci_trusted_repositories" USING btree ("created_by_id");