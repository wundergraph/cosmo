ALTER TABLE "schema_checks" ADD COLUMN "schema_version_id" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_checks" ADD CONSTRAINT "schema_checks_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
