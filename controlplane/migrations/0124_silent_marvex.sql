ALTER TABLE "proposal_subgraphs" ADD COLUMN "current_schema_version_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraphs_current_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("current_schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
