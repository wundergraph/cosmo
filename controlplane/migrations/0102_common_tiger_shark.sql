ALTER TABLE "subgraphs" DROP CONSTRAINT "subgraphs_schema_version_id_schema_versions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
