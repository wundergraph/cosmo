-- Custom SQL migration file --

DO $$ BEGIN
 CREATE TYPE "public"."graph_composition_subgraph_change_type" AS ENUM('added', 'removed', 'updated', 'unchanged');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "schema_versions" DROP CONSTRAINT "schema_versions_target_id_targets_id_fk";
--> statement-breakpoint
ALTER TABLE "graph_composition_subgraphs" ADD COLUMN "subgraph_id" uuid;--> statement-breakpoint
ALTER TABLE "graph_composition_subgraphs" ADD COLUMN "subgraph_target_id" uuid;--> statement-breakpoint
ALTER TABLE "graph_composition_subgraphs" ADD COLUMN "subgraph_name" text;--> statement-breakpoint
ALTER TABLE "graph_composition_subgraphs" ADD COLUMN "change_type" "graph_composition_subgraph_change_type" DEFAULT 'unchanged';--> statement-breakpoint
ALTER TABLE "graph_composition_subgraphs" ADD COLUMN "is_feature_subgraph" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "schema_versions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_versions" ADD CONSTRAINT "schema_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "is_redelivery";

-- Populate new columns with existing data
BEGIN TRANSACTION;
UPDATE "graph_composition_subgraphs" gcs
SET 
  "subgraph_id" = s.id,
  "subgraph_target_id" = t.id,
  "subgraph_name" = t.name,
  "is_feature_subgraph" = s.is_feature_subgraph
FROM "schema_versions" sv
JOIN "targets" t ON sv.target_id = t.id
JOIN "subgraphs" s ON t.id = s.target_id
WHERE gcs.schema_version_id = sv.id;

UPDATE "graph_composition_subgraphs"
SET "change_type" = 'unchanged'
WHERE "change_type" IS NULL;

UPDATE "schema_versions"
SET "organization_id" = (SELECT "organization_id" FROM "targets" WHERE "id" = "schema_versions"."target_id")
WHERE "organization_id" IS NULL;
COMMIT;

-- Make new columns not null
ALTER TABLE "graph_composition_subgraphs" 
  ALTER COLUMN "subgraph_id" SET NOT NULL,
  ALTER COLUMN "subgraph_target_id" SET NOT NULL,
  ALTER COLUMN "subgraph_name" SET NOT NULL,
  ALTER COLUMN "change_type" SET NOT NULL,
  ALTER COLUMN "is_feature_subgraph" SET NOT NULL;

ALTER TABLE "schema_versions" 
  ALTER COLUMN "organization_id" SET NOT NULL;