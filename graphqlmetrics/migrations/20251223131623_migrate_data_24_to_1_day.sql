-- migrate:up

-- Step 4: Migrate data from 24 to 1 day ago
INSERT INTO gql_metrics_schema_usage_5m_90d_v2
SELECT * FROM gql_metrics_schema_usage_5m_90d
WHERE Timestamp >= now() - INTERVAL 24 DAY
  AND Timestamp < now() - INTERVAL 1 DAY;

-- migrate:down

