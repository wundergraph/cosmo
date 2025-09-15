CREATE TYPE "public"."subgraph_type" AS ENUM('standard', 'grpc_plugin', 'grpc_service');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version_id" uuid NOT NULL,
	"version" text NOT NULL,
	"platform" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "protobuf_schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version_id" uuid NOT NULL,
	"proto_schema" text NOT NULL,
	"proto_mappings" text NOT NULL,
	"proto_lock" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subgraphs" ADD COLUMN "type" "subgraph_type" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugin_image_versions" ADD CONSTRAINT "plugin_image_versions_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "protobuf_schema_versions" ADD CONSTRAINT "protobuf_schema_versions_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
