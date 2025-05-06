-- migrate:up

DROP TABLE IF EXISTS gql_metrics_schema_usage;

-- migrate:down

CREATE TABLE IF NOT EXISTS gql_metrics_schema_usage
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(3)),
    `OrganizationID` LowCardinality(String) CODEC(ZSTD(3)),
    `FederatedGraphID` LowCardinality(String) CODEC(ZSTD(3)),
    `RouterConfigVersion` LowCardinality(String) CODEC(ZSTD(3)),
    `OperationHash` LowCardinality(String) CODEC(ZSTD(3)),
    `OperationName` LowCardinality(String) CODEC(ZSTD(3)),
    `OperationType` LowCardinality(String) CODEC(ZSTD(3)),
    `Count` UInt64 CODEC(Delta(8), ZSTD(3)),
    `Path` Array(String) CODEC(ZSTD(3)),
    `TypeNames` Array(String) CODEC(ZSTD(3)),
    `NamedType` String CODEC(ZSTD(3)),
    `ClientName` LowCardinality(String) CODEC(ZSTD(3)),
    `ClientVersion` LowCardinality(String) CODEC(ZSTD(3)),
    `HttpStatusCode` String CODEC(ZSTD(3)),
    `HasError` Bool CODEC(ZSTD(3)),
    `SubgraphIDs` Array(LowCardinality(String)) CODEC(ZSTD(3)),
    `IsArgument` Bool CODEC(ZSTD(3)),
    `IsInput` Bool CODEC(ZSTD(3)),
    `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(3)),
    `IsIndirectFieldUsage` Bool DEFAULT false CODEC(ZSTD(3)),
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_source_ids SubgraphIDs TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_count Count TYPE minmax GRANULARITY 1
)
    ENGINE = MergeTree
        PARTITION BY toDate(Timestamp)
        ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, HttpStatusCode, HasError, toUnixTimestamp(Timestamp))
        TTL toDateTime(Timestamp) + toIntervalDay(7)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1

