CREATE TYPE "public"."audit_log_stream_kind" AS ENUM('splunk_hec');--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ADD COLUMN "kind" "audit_log_stream_kind" DEFAULT 'splunk_hec' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ADD COLUMN "secret" text;--> statement-breakpoint
UPDATE "audit_log_stream_configs" SET "settings" = jsonb_build_object('endpoint', "endpoint", 'index', "index", 'source', "source", 'sourcetype', "sourcetype"), "secret" = "token";--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ALTER COLUMN "settings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" ALTER COLUMN "secret" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" DROP COLUMN IF EXISTS "endpoint";--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" DROP COLUMN IF EXISTS "token";--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" DROP COLUMN IF EXISTS "index";--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" DROP COLUMN IF EXISTS "source";--> statement-breakpoint
ALTER TABLE "audit_log_stream_configs" DROP COLUMN IF EXISTS "sourcetype";
