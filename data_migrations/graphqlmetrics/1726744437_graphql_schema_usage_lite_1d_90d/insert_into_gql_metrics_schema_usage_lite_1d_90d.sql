INSERT INTO gql_metrics_schema_usage_lite_1d_90d
SELECT
    -- Aggregate data into daily (1d) buckets
    toStartOfDay(Timestamp) as Timestamp,
    toLowCardinality(OrganizationID) as OrganizationID,
    toLowCardinality(FederatedGraphID) as FederatedGraphID,
    toLowCardinality(RouterConfigVersion) as RouterConfigVersion,
    toLowCardinality(OperationHash) as OperationHash,
    -- OperationName is already part of the hash, no need to group by it
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
    IsInput as IsInput
FROM gql_metrics_schema_usage_5m_90d;