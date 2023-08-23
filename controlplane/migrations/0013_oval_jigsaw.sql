CREATE TABLE IF NOT EXISTS "schema_check_composition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"composition_errors" text,
	"composed_schema_sdl" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "has_breaking_changes" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "composition_errors";--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "composed_schema_sdl";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_composition" ADD CONSTRAINT "schema_check_composition_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_composition" ADD CONSTRAINT "schema_check_composition_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
