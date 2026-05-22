ALTER TABLE "namespace_sso_providers" DROP CONSTRAINT "nssp_xor_check";--> statement-breakpoint
DROP INDEX IF EXISTS "nssp_unique_password";--> statement-breakpoint
ALTER TABLE "namespace_sso_providers" ADD COLUMN "is_google_login" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "namespace_sso_providers" ADD COLUMN "is_github_login" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nssp_unique_builtin" ON "namespace_sso_providers" USING btree ("namespace_id") WHERE "namespace_sso_providers"."sso_provider_id" IS NULL;--> statement-breakpoint
ALTER TABLE "namespace_sso_providers" ADD CONSTRAINT "nssp_builtin_xor_sso_check" CHECK (("namespace_sso_providers"."sso_provider_id" IS NOT NULL) <> ("namespace_sso_providers"."is_password_login" OR "namespace_sso_providers"."is_google_login" OR "namespace_sso_providers"."is_github_login"));