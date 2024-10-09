-- migrate:up
ALTER TABLE gql_metrics_schema_usage ADD COLUMN IF NOT EXISTS IsIndirectFieldUsage bool DEFAULT false;

-- migrate:down

ALTER TABLE gql_metrics_schema_usage DROP COLUMN IsIndirectFieldUsage;
