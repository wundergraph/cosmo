CREATE TYPE "public"."batch_publish_job_status" AS ENUM('pending', 'processing', 'failed', 'completed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_publish_job_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "batch_publish_job_status" NOT NULL,
	"organization_id" uuid NOT NULL,
	"failure_reason" text,
	"composition_result" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_publish_job_details_job_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"namespace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	CONSTRAINT "batch_publish_job_details_job_locks_namespace_id_key" UNIQUE("namespace_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batch_publish_job_details" ADD CONSTRAINT "batch_publish_job_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batch_publish_job_details_job_locks" ADD CONSTRAINT "batch_publish_job_details_job_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batch_publish_job_details_job_locks" ADD CONSTRAINT "batch_publish_job_details_job_locks_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batch_publish_job_details_job_locks" ADD CONSTRAINT "batch_publish_job_details_job_locks_job_id_batch_publish_job_details_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."batch_publish_job_details"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
