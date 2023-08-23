ALTER TABLE "federated_graphs" RENAME COLUMN "composedSchemaVersionId" TO "composed_schema_version_id";--> statement-breakpoint
ALTER TABLE "federated_graphs" DROP CONSTRAINT "federated_graphs_composedSchemaVersionId_schema_versions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graphs" ADD CONSTRAINT "federated_graphs_composed_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("composed_schema_version_id") REFERENCES "schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
