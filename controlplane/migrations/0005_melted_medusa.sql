ALTER TABLE "federated_graphs" RENAME COLUMN "schema_version_id" TO "composedSchemaVersionId";--> statement-breakpoint
ALTER TABLE "federated_graphs" DROP CONSTRAINT "federated_graphs_schema_version_id_schema_versions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs" ADD CONSTRAINT "federated_graphs_composedSchemaVersionId_schema_versions_id_fk" FOREIGN KEY ("composedSchemaVersionId") REFERENCES "schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
