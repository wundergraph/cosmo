-- migrate:up

DROP TABLE IF EXISTS gql_metrics_schema_usage_5m_90d;

-- migrate:down

CREATE TABLE gql_metrics_schema_usage_5m_90d
(
    Timestamp DateTime('UTC') CODEC(Delta(4), ZSTD(3)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
    RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)),
    OperationHash LowCardinality(String) CODEC(ZSTD(3)),
    OperationName LowCardinality(String) CODEC(ZSTD(3)),
    OperationType LowCardinality(String) CODEC(ZSTD(3)),
    Path Array(String) CODEC(ZSTD(3)),
    FieldName LowCardinality(String) CODEC(ZSTD(3)),
    TypeNames Array(String) CODEC(ZSTD(3)),
    NamedType LowCardinality(String) CODEC(ZSTD(3)),
    ClientName LowCardinality(String) CODEC(ZSTD(3)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(3)),
    SubgraphIDs Array(LowCardinality(String)) CODEC(ZSTD(3)),
    IsArgument Bool CODEC(ZSTD(3)),
    IsInput Bool CODEC(ZSTD(3)),
    TotalUsages UInt64 CODEC(ZSTD(3)),
    TotalErrors UInt64 CODEC(ZSTD(3)),
    TotalClientErrors UInt64 CODEC(ZSTD(3)),
    IsIndirectFieldUsage Bool DEFAULT false CODEC(ZSTD(3)),
    IsNull Bool DEFAULT false CODEC(ZSTD(3)),
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_source_ids SubgraphIDs TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_total_usages TotalUsages TYPE minmax GRANULARITY 1,
    INDEX idx_total_errors TotalErrors TYPE minmax GRANULARITY 1,
    INDEX idx_total_client_errors TotalClientErrors TYPE minmax GRANULARITY 1
)
ENGINE = SharedSummingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY toDate(Timestamp)
ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, Path, FieldName, NamedType, TypeNames, SubgraphIDs, IsArgument, IsInput, toUnixTimestamp(Timestamp))
TTL toDateTime(Timestamp) + toIntervalDay(90)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1