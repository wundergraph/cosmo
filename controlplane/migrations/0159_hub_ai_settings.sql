CREATE TABLE IF NOT EXISTS "hub_ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"settings" json NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ai_settings" ADD CONSTRAINT "hub_ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
