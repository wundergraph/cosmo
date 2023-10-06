DO $$ BEGIN
 CREATE TYPE "webhook_type" AS ENUM('webhook', 'slack');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "organization_webhook_configs" ADD COLUMN "type" "webhook_type" DEFAULT 'webhook' NOT NULL;