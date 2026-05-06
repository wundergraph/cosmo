ALTER TABLE "feature_flags" ADD COLUMN "traffic_percentage" integer;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_traffic_percentage_range_chk" CHECK ("traffic_percentage" IS NULL OR ("traffic_percentage" BETWEEN 0 AND 100));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ff_proposal_id_idx" ON "feature_flags" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ff_proposal_id_uniq_idx" ON "feature_flags" ("proposal_id") WHERE "proposal_id" IS NOT NULL;
