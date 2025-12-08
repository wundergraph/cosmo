-- migrate:up

ALTER TABLE gql_metrics_schema_usage ADD COLUMN IF NOT EXISTS IsNull bool DEFAULT false CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_metrics_schema_usage DROP COLUMN IF EXISTS IsNull;
