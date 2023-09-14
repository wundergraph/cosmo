CREATE TABLE IF NOT EXISTS "organization_webhook_configs" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"endpoint" text,
	"key" text,
	"events" text[]
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_webhook_configs" ADD CONSTRAINT "organization_webhook_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
