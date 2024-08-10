DO $$ BEGIN CREATE TYPE "public"."webhook_delivery_type" AS ENUM('webhook', 'slack', 'admission');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"organization_id" uuid NOT NULL,
	"type" "webhook_delivery_type" NOT NULL,
	"endpoint" text NOT NULL,
	"event_name" text NOT NULL,
	"payload" text NOT NULL,
	"request_headers" json NOT NULL,
	"response_headers" json,
	"response_status_code" integer,
	"response_error_code" text,
	"error_message" text,
	"response_body" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"duration" real DEFAULT 0 NOT NULL,
	"is_redelivery" boolean DEFAULT false NOT NULL,
	"original_delivery_id" text
);
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "webhook_deliveries"
ADD CONSTRAINT "webhook_deliveries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE
set null ON UPDATE no action;
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "webhook_deliveries"
ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
WHEN duplicate_object THEN null;
END $$;