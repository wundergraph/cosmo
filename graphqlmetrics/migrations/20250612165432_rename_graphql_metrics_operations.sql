-- migrate:up
RENAME TABLE graphql_metrics_operations TO gql_metrics_operations;

-- migrate:down

RENAME TABLE gql_metrics_operations TO graphql_metrics_operations;