-- migrate:up

ALTER TABLE gql_metrics_schema_usage MODIFY COLUMN IsIndirectFieldUsage CODEC(ZSTD(3));

-- migrate:down

