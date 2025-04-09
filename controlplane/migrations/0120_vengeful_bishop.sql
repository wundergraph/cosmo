ALTER TABLE "schema_check_proposals" RENAME TO "proposal_checks";--> statement-breakpoint
ALTER TABLE "proposal_checks" DROP CONSTRAINT "schema_check_proposals_schema_check_id_schema_checks_id_fk";
--> statement-breakpoint
ALTER TABLE "proposal_checks" DROP CONSTRAINT "schema_check_proposals_proposal_id_proposals_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "scp_check_id_proposal_id_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_checks" ADD CONSTRAINT "proposal_checks_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_checks" ADD CONSTRAINT "proposal_checks_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pc_check_id_proposal_id_idx" ON "proposal_checks" USING btree ("schema_check_id","proposal_id");