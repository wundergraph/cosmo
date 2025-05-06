-- migrate:up

ALTER TABLE gql_metrics_schema_usage_lite_1d_90d ADD COLUMN IF NOT EXISTS IsIndirectFieldUsage bool DEFAULT false;

-- migrate:down

ALTER TABLE gql_metrics_schema_usage_lite_1d_90d DROP COLUMN IsIndirectFieldUsage;