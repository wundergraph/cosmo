-- migrate:up

ALTER TABLE gql_metrics_schema_usage_lite_1d_90d MODIFY COLUMN IsIndirectFieldUsage CODEC(ZSTD(3));
-- migrate:down

