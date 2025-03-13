-- migrate:up
CREATE MATERIALIZED VIEW IF NOT EXISTS graphql_metrics_operations_mv TO graphql_metrics_operations AS
SELECT
    Timestamp,
    toLowCardinality(OperationName) as OperationName,
    toLowCardinality(OperationHash) as OperationHash,
    toLowCardinality(OperationType) as OperationType,
    OperationContent as OperationContent,
    toLowCardinality(OrganizationID) as OrganizationID,
    toLowCardinality(FederatedGraphID) as FederatedGraphID
FROM gql_metrics_operations

-- migrate:down

DROP VIEW IF EXISTS graphql_metrics_operations_mv