CREATE TABLE IF NOT EXISTS "organization_feature_terms_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"last_accepted_by_id" uuid,
	"last_accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_feature_terms_acceptance" ADD CONSTRAINT "organization_feature_terms_acceptance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_feature_terms_acceptance" ADD CONSTRAINT "organization_feature_terms_acceptance_last_accepted_by_id_users_id_fk" FOREIGN KEY ("last_accepted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_fta_idx" ON "organization_feature_terms_acceptance" USING btree ("organization_id","feature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_fta_organization_id_idx" ON "organization_feature_terms_acceptance" USING btree ("organization_id");