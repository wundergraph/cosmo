CREATE TYPE "public"."batch_publish_job_status" AS ENUM('pending', 'failed', 'completed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_publish_job_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "batch_publish_job_status" NOT NULL,
	"organization_id" uuid NOT NULL,
	"failure_reason" text,
	"composition_result" json,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batch_publish_job_details" ADD CONSTRAINT "batch_publish_job_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
