CREATE TYPE "public"."proposal_match" AS ENUM('success', 'warn', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_proposal_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_match" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "proposal_match" "proposal_match";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposal_match" ADD CONSTRAINT "schema_check_proposal_match_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposal_match" ADD CONSTRAINT "schema_check_proposal_match_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scpm_schema_check_id_idx" ON "schema_check_proposal_match" USING btree ("schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scpm_proposal_id_idx" ON "schema_check_proposal_match" USING btree ("proposal_id");