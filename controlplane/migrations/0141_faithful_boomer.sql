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
ALTER TABLE "namespace_sso_providers" RENAME TO "namespace_login_methods";--> statement-breakpoint
ALTER TABLE "namespace_login_methods" DROP CONSTRAINT "nssp_builtin_xor_sso_check";--> statement-breakpoint
ALTER TABLE "namespace_login_methods" DROP CONSTRAINT "namespace_sso_providers_namespace_id_namespaces_id_fk";
--> statement-breakpoint
ALTER TABLE "namespace_login_methods" DROP CONSTRAINT "namespace_sso_providers_sso_provider_id_oidc_providers_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "nssp_namespace_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "nssp_sso_provider_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "nssp_unique_sso";--> statement-breakpoint
DROP INDEX IF EXISTS "nssp_unique_builtin";--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS "olm_unique_builtin" ON "organization_login_methods" USING btree ("organization_id") WHERE "organization_login_methods"."sso_provider_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_login_methods" ADD CONSTRAINT "namespace_login_methods_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_login_methods" ADD CONSTRAINT "namespace_login_methods_sso_provider_id_oidc_providers_id_fk" FOREIGN KEY ("sso_provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nlm_namespace_id_idx" ON "namespace_login_methods" USING btree ("namespace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nlm_sso_provider_id_idx" ON "namespace_login_methods" USING btree ("sso_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nlm_unique_sso" ON "namespace_login_methods" USING btree ("namespace_id","sso_provider_id") WHERE "namespace_login_methods"."sso_provider_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nlm_unique_builtin" ON "namespace_login_methods" USING btree ("namespace_id") WHERE "namespace_login_methods"."sso_provider_id" IS NULL;--> statement-breakpoint
ALTER TABLE "namespace_login_methods" ADD CONSTRAINT "nlm_builtin_xor_sso_check" CHECK (("namespace_login_methods"."sso_provider_id" IS NOT NULL) <> ("namespace_login_methods"."is_password_login" OR "namespace_login_methods"."is_google_login" OR "namespace_login_methods"."is_github_login"));