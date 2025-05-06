-- migrate:up
ALTER TABLE gql_metrics_schema_usage_5m_90d ADD COLUMN IF NOT EXISTS IsIndirectFieldUsage bool DEFAULT false;

-- migrate:down

ALTER TABLE gql_metrics_schema_usage_5m_90d DROP COLUMN IsIndirectFieldUsage;