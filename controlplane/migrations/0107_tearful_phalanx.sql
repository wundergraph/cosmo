DO $$ BEGIN
 CREATE TYPE "public"."playground_script_type" AS ENUM('pre-flight', 'pre-operation', 'post-operation');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playground_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"type" "playground_script_type" NOT NULL,
	"content" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playground_scripts" ADD CONSTRAINT "playground_scripts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playground_scripts" ADD CONSTRAINT "playground_scripts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ps_organization_id_idx" ON "playground_scripts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ps_created_by_id_idx" ON "playground_scripts" USING btree ("created_by_id");