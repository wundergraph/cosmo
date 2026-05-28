CREATE TABLE IF NOT EXISTS "organization_login_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sso_provider_id" uuid,
	"is_password_login" boolean DEFAULT false NOT NULL,
	"is_google_login" boolean DEFAULT false NOT NULL,
	"is_github_login" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "olm_builtin_xor_sso_check" CHECK (("organization_login_methods"."sso_provider_id" IS NOT NULL) <> ("organization_login_methods"."is_password_login" OR "organization_login_methods"."is_google_login" OR "organization_login_methods"."is_github_login"))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_login_methods" ADD CONSTRAINT "organization_login_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_login_methods" ADD CONSTRAINT "organization_login_methods_sso_provider_id_oidc_providers_id_fk" FOREIGN KEY ("sso_provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "olm_organization_id_idx" ON "organization_login_methods" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "olm_sso_provider_id_idx" ON "organization_login_methods" USING btree ("sso_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "olm_unique_sso" ON "organization_login_methods" USING btree ("organization_id","sso_provider_id") WHERE "organization_login_methods"."sso_provider_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "olm_unique_builtin" ON "organization_login_methods" USING btree ("organization_id") WHERE "organization_login_methods"."sso_provider_id" IS NULL;