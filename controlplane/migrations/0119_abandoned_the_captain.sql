CREATE TABLE IF NOT EXISTS "schema_check_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" DROP CONSTRAINT "proposal_subgraph";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposals" ADD CONSTRAINT "schema_check_proposals_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_proposals" ADD CONSTRAINT "schema_check_proposals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scp_check_id_proposal_id_idx" ON "schema_check_proposals" USING btree ("schema_check_id","proposal_id");--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraph" UNIQUE("proposal_id","subgraph_name");