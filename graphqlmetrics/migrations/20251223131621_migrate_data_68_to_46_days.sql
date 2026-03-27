-- migrate:up

-- Step 2: Migrate data from 68 to 46 days ago
INSERT INTO gql_metrics_schema_usage_5m_90d_v2
SELECT * FROM gql_metrics_schema_usage_5m_90d
WHERE Timestamp >= now() - INTERVAL 68 DAY
  AND Timestamp < now() - INTERVAL 46 DAY;

-- migrate:down

