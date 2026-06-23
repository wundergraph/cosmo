CREATE TABLE IF NOT EXISTS "namespace_sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"sso_provider_id" uuid,
	"is_password_login" boolean DEFAULT false NOT NULL,
	"is_google_login" boolean DEFAULT false NOT NULL,
	"is_github_login" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nssp_builtin_xor_sso_check" CHECK (("namespace_sso_providers"."sso_provider_id" IS NOT NULL) <> ("namespace_sso_providers"."is_password_login" OR "namespace_sso_providers"."is_google_login" OR "namespace_sso_providers"."is_github_login"))
);
--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idp_alias" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_sso_providers" ADD CONSTRAINT "namespace_sso_providers_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_sso_providers" ADD CONSTRAINT "namespace_sso_providers_sso_provider_id_oidc_providers_id_fk" FOREIGN KEY ("sso_provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nssp_namespace_id_idx" ON "namespace_sso_providers" USING btree ("namespace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nssp_sso_provider_id_idx" ON "namespace_sso_providers" USING btree ("sso_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nssp_unique_sso" ON "namespace_sso_providers" USING btree ("namespace_id","sso_provider_id") WHERE "namespace_sso_providers"."sso_provider_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nssp_unique_builtin" ON "namespace_sso_providers" USING btree ("namespace_id") WHERE "namespace_sso_providers"."sso_provider_id" IS NULL;