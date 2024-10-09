-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS gql_metrics_schema_usage_lite_1d_90d_mv TO gql_metrics_schema_usage_lite_1d_90d AS
SELECT
    -- We aggregate into 1d buckets
    toStartOfDay(Timestamp) as Timestamp,
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
    IsIndirectFieldUsage as IsIndirectFieldUsage
FROM gql_metrics_schema_usage;

-- migrate:down

DROP VIEW IF EXISTS gql_metrics_schema_usage_lite_1d_90d_mv