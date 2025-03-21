CREATE TABLE IF NOT EXISTS "namespace_config" (
	"namespace_id" uuid NOT NULL,
	"enable_linting" boolean DEFAULT false NOT NULL,
	"enable_graph_pruning" boolean DEFAULT false NOT NULL,
	"enable_cache_warming" boolean DEFAULT false NOT NULL,
	"checks_timeframe_in_days" integer,
	CONSTRAINT "unique_namespace" UNIQUE("namespace_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_config" ADD CONSTRAINT "namespace_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Copy existing namespace configurations to the new table
BEGIN TRANSACTION;

INSERT INTO "public"."namespace_config" ("namespace_id", "enable_linting", "enable_graph_pruning", "enable_cache_warming")
SELECT "id", "enable_linting", "enable_graph_pruning", "enable_cache_warming"
FROM "public"."namespaces";

COMMIT;

--> statement-breakpoint
ALTER TABLE "namespaces" DROP COLUMN IF EXISTS "enable_linting";--> statement-breakpoint
ALTER TABLE "namespaces" DROP COLUMN IF EXISTS "enable_graph_pruning";--> statement-breakpoint
ALTER TABLE "namespaces" DROP COLUMN IF EXISTS "enable_cache_warming";