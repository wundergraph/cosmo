-- migrate:up

-- Step 5: Migrate data from the last 1 day
INSERT INTO gql_metrics_schema_usage_5m_90d_v2
SELECT * FROM gql_metrics_schema_usage_5m_90d
WHERE Timestamp >= now() - INTERVAL 1 DAY;

-- migrate:down

