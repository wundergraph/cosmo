CREATE TABLE IF NOT EXISTS "onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"version" text DEFAULT 'v1' NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"slack" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "onboarding_version_unique" UNIQUE("version"),
	CONSTRAINT "onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
)
