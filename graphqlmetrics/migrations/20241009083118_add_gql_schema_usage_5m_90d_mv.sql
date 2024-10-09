-- migrate:up
CREATE MATERIALIZED VIEW IF NOT EXISTS gql_metrics_schema_usage_5m_90d_mv TO gql_metrics_schema_usage_5m_90d AS
SELECT
    -- We aggregate into 5m buckets because this is the smallest resolution we need for the dashboard.
    toStartOfFiveMinute(Timestamp) as Timestamp,
    toLowCardinality(OrganizationID) as OrganizationID,
    toLowCardinality(FederatedGraphID) as FederatedGraphID,
    toLowCardinality(RouterConfigVersion) as RouterConfigVersion,
    toLowCardinality(OperationHash) as OperationHash,
    -- Already part of the hash. Therefore we don't need to group by it.
    toLowCardinality(OperationName) as OperationName,
    toLowCardinality(OperationType) as OperationType,
    Path as Path,
    toLowCardinality(arrayElement(Path, -1)) as FieldName,
    TypeNames as TypeNames,
    toLowCardinality(NamedType) as NamedType,
    toLowCardinality(ClientName) as ClientName,
    toLowCardinality(ClientVersion) as ClientVersion,
    SubgraphIDs as SubgraphIDs,
    IsArgument as IsArgument,
    IsInput as IsInput,
    sum(Count) as TotalUsages,
    sumIf(Count, HasError OR position(HttpStatusCode,'5') = 1 OR position(HttpStatusCode,'4') = 1) as TotalErrors,
    sumIf(Count, position(HttpStatusCode,'4') = 1) AS TotalClientErrors,
    IsIndirectFieldUsage as IsIndirectFieldUsage
FROM gql_metrics_schema_usage
GROUP BY
    Timestamp,
    OperationHash,
    OperationName,
    OperationType,
    FederatedGraphID,
    RouterConfigVersion,
    OrganizationID,
    OperationType,
    ClientName,
    ClientVersion,
    Path,
    FieldName,
    NamedType,
    TypeNames,
    SubgraphIDs,
    IsArgument,
    IsInput,
    IsIndirectFieldUsage
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS gql_metrics_schema_usage_5m_90d_mv