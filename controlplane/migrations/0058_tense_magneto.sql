CREATE TABLE IF NOT EXISTS "organization_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requests_limit" integer DEFAULT 10 NOT NULL,
	"analytics_retention_limit" integer DEFAULT 7 NOT NULL,
	"tracing_retention_limit" integer DEFAULT 7 NOT NULL,
	"changelog_data_retention_limit" integer DEFAULT 7 NOT NULL,
	"breaking_change_retention_limit" integer DEFAULT 7 NOT NULL,
	"trace_sampling_rate_limit" numeric(3, 2) DEFAULT '0.10' NOT NULL
);
--> statement-breakpoint

--> Inserting the org limits for all the current organizations
BEGIN TRANSACTION;
INSERT INTO "organization_limits" ("organization_id", "requests_limit", "analytics_retention_limit", "tracing_retention_limit", "changelog_data_retention_limit", "breaking_change_retention_limit","trace_sampling_rate_limit")
SELECT "id",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 50
           WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 30
           ELSE 10
           END AS "requests_limit",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 30
		   WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 30
           ELSE 7
           END AS "analytics_retention_limit",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 30
		   WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 30
           ELSE 7
           END AS "tracing_retention_limit",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 30
		   WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 30
           ELSE 7
           END AS "changelog_data_retention_limit",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 30
		   WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 30
           ELSE 7
           END AS "breaking_change_retention_limit",
       CASE
           WHEN "id" = 'c63397bd-a373-4235-90d6-b5a23771923e' THEN 0.30
           WHEN "id" = '391d2d8a-af23-4249-898c-a10487de4894' THEN 0.35
           ELSE 0.10
           END AS "sampling_rate_limit"
FROM "organizations";

COMMIT;

DROP TABLE "federated_graph_configs";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_limits" ADD CONSTRAINT "organization_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
