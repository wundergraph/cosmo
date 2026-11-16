CREATE TABLE IF NOT EXISTS "audit_log_stream_configs" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"token" text NOT NULL,
	"index" text,
	"source" text NOT NULL,
	"sourcetype" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor_id" uuid,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log_stream_configs" ADD CONSTRAINT "audit_log_stream_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
