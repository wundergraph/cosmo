
-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS gql_metrics_schema_usage_1h_90d_mv (
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(3)),

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
    TypeNames Array(String) CODEC(ZSTD(3)),

    -- Client information
    ClientName LowCardinality(String) CODEC(ZSTD(3)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(3)),

    -- SubgraphIDs identify the subgraphs that were used to resolve the field
    SubgraphIDs Array(LowCardinality(String)) CODEC(ZSTD(3)),

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
ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, Path, TypeNames, SubgraphIDs, toUnixTimestamp(Timestamp))
-- We store 90 days of data in this table.
TTL toDateTime(Timestamp) + toIntervalDay(90) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
-- Aggregate histogram buckets into a 1h minute window, Counts are summed.
SELECT
    -- We aggregate into 1h buckets because this is the smallest resolution we need for the dashboard.
    toStartOfHour(Timestamp) as Timestamp,
    OrganizationID,
    FederatedGraphID,
    RouterConfigVersion,
    OperationHash,
    -- Already part of the hash. Therefore we don't need to group by it.
    last_value(OperationName),
    last_value(OperationType),
    Path,
    TypeNames,
    ClientName,
    ClientVersion,
    SubgraphIDs,
    sum(Count) as TotalUsages,
    sumIf(Count, position(Attributes['http.status_code'],'5') = 1 OR position(Attributes['http.status_code'],'4') = 1) as TotalErrors,
    sumIf(Count, position(Attributes['http.status_code'],'4') = 1) AS TotalClientErrors
FROM gql_metrics_schema_usage
GROUP BY
    Timestamp,
    OperationHash,
    FederatedGraphID,
    RouterConfigVersion,
    OrganizationID,
    OperationType,
    ClientName,
    ClientVersion,
    Path,
    TypeNames,
    SubgraphIDs
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS gql_metrics_schema_usage_1h_90d_mv