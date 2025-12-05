-- migrate:up

ALTER TABLE gql_metrics_schema_usage_5m_90d ADD COLUMN IF NOT EXISTS IsNull bool DEFAULT false CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_metrics_schema_usage_5m_90d DROP COLUMN IF EXISTS IsNull;
