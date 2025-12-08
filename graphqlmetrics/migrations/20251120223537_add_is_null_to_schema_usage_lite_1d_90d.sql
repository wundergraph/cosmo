-- migrate:up

ALTER TABLE gql_metrics_schema_usage_lite_1d_90d ADD COLUMN IF NOT EXISTS IsNull bool DEFAULT false CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_metrics_schema_usage_lite_1d_90d DROP COLUMN IF EXISTS IsNull;
