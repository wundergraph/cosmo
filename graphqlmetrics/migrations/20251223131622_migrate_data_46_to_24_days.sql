-- migrate:up

-- Step 3: Migrate data from 46 to 24 days ago
INSERT INTO gql_metrics_schema_usage_5m_90d_v2
SELECT * FROM gql_metrics_schema_usage_5m_90d
WHERE Timestamp >= now() - INTERVAL 46 DAY
  AND Timestamp < now() - INTERVAL 24 DAY;

-- migrate:down

