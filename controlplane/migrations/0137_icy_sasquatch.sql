CREATE TABLE IF NOT EXISTS "onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"slack" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "onboarding" ADD CONSTRAINT "onboarding_user_id_organization_id_version_unique" UNIQUE ("user_id", "organization_id", "version");
