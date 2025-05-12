ALTER TABLE "schema_check_subgraphs" ADD COLUMN "namespace_id" uuid;--> statement-breakpoint

BEGIN TRANSACTION;
UPDATE "schema_check_subgraphs"
SET "namespace_id" = "targets"."namespace_id"
FROM "subgraphs"
INNER JOIN "targets" ON "subgraphs"."target_id" = "targets".id
WHERE "subgraphs".id = "schema_check_subgraphs"."subgraph_id";

COMMIT;

DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs" ADD CONSTRAINT "schema_check_subgraphs_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
