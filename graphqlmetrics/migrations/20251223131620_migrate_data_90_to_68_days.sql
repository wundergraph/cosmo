-- migrate:up

-- Step 1: Migrate data from 90 to 68 days ago
INSERT INTO gql_metrics_schema_usage_5m_90d_v2
SELECT * FROM gql_metrics_schema_usage_5m_90d
WHERE Timestamp >= now() - INTERVAL 90 DAY
  AND Timestamp < now() - INTERVAL 68 DAY;

-- migrate:down

