ALTER TABLE "subgraphs" ADD COLUMN "schema_version_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
