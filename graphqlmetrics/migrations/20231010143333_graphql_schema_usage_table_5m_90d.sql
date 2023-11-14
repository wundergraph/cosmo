-- migrate:up

CREATE TABLE IF NOT EXISTS gql_metrics_schema_usage_5m_90d
(
    Timestamp DateTime('UTC') CODEC(Delta, ZSTD(3)),

    -- Organization
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),

    -- Router configuration
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
    RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)), -- running schema version

    -- Operation
    OperationHash LowCardinality(String) CODEC(ZSTD(3)),
    OperationName LowCardinality(String) CODEC(ZSTD(3)),
    OperationType LowCardinality(String) CODEC(ZSTD(3)), -- query, mutation, subscription

    -- Schema usage
    Path Array(String) CODEC(ZSTD(3)),
    FieldName LowCardinality(String) CODEC(ZSTD(3)),
    TypeNames Array(String) CODEC(ZSTD(3)),
    NamedType LowCardinality(String) CODEC(ZSTD(3)),

    -- Client information
    ClientName LowCardinality(String) CODEC(ZSTD(3)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(3)),

    -- SubgraphIDs identify the subgraphs that were used to resolve the field
    SubgraphIDs Array(LowCardinality(String)) CODEC(ZSTD(3)),

    -- Indicates if the usage was from an argument or a field
    IsArgument bool CODEC(ZSTD(3)),

    -- Indicates if the usage was from an input field
    IsInput bool CODEC(ZSTD(3)),

    --- Total usages
    TotalUsages UInt64 CODEC(ZSTD(3)),
    TotalErrors UInt64 CODEC(ZSTD(3)),
    TotalClientErrors UInt64 CODEC(ZSTD(3)),

    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_source_ids SubgraphIDs TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_total_usages TotalUsages TYPE minmax GRANULARITY 1,
    INDEX idx_total_errors TotalErrors TYPE minmax GRANULARITY 1,
    INDEX idx_total_client_errors TotalClientErrors TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, Path, FieldName, NamedType, TypeNames, SubgraphIDs, IsArgument, IsInput, toUnixTimestamp(Timestamp))
-- We store 90 days of data in this table.
TTL toDateTime(Timestamp) + toIntervalDay(90) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1

-- migrate:down

DROP TABLE IF EXISTS gql_metrics_schema_usage_5m_90d;
