-- migrate:up
ALTER TABLE gql_metrics_operations ADD COLUMN IF NOT EXISTS FederatedGraphID LowCardinality(String) CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_metrics_operations DROP COLUMN FederatedGraphID;