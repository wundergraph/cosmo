-- migrate:up

RENAME TABLE gql_metrics_schema_usage_5m_90d_v2 TO gql_metrics_schema_usage_5m_90d;

-- migrate:down

RENAME TABLE gql_metrics_schema_usage_5m_90d TO gql_metrics_schema_usage_5m_90d_v2;