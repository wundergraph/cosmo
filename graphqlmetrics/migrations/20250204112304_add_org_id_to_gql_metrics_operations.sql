-- migrate:up
ALTER TABLE gql_metrics_operations ADD COLUMN IF NOT EXISTS OrganizationID LowCardinality(String) CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_metrics_operations DROP COLUMN OrganizationID;