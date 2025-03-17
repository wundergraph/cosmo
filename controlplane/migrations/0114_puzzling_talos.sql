CREATE TABLE IF NOT EXISTS "namespace_config" (
	"namespace_id" uuid NOT NULL,
	"enable_linting" boolean,
	"enable_graph_pruning" boolean,
	"enable_cache_warming" boolean,
	"checks_timeframe_in_days" integer,
	CONSTRAINT "unique_namespace" UNIQUE("namespace_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_config" ADD CONSTRAINT "namespace_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--
BEGIN TRANSACTION;

INSERT INTO "public"."namespace_config" ("namespace_id", "enable_linting", "enable_graph_pruning", "enable_cache_warming")
SELECT "id", "enable_linting", "enable_graph_pruning", "enable_cache_warming"
FROM "public"."namespaces";

COMMIT;