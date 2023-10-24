
-- migrate:up

CREATE TABLE cosmo.operation_latency_metrics_5_30 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName LowCardinality(String) CODEC (ZSTD(1)),
   OperationHash String CODEC (ZSTD(1)),
   OperationType LowCardinality(String) CODEC (ZSTD(1)),
   RouterConfigVersion LowCardinality(String) CODEC(ZSTD(1)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(1)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(1)),
   ClientName LowCardinality(String) CODEC (ZSTD(1)),
   ClientVersion LowCardinality(String) CODEC (ZSTD(1)),
   BucketCounts AggregateFunction(sumForEach, Array(UInt64)) CODEC(ZSTD(1)),
   ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
   Sum SimpleAggregateFunction(sum, Float64) CODEC(ZSTD(1)),
   Count SimpleAggregateFunction(sum, UInt64) CODEC(ZSTD(1)),
   MinDuration SimpleAggregateFunction(min, Float64) CODEC(ZSTD(1)),
   MaxDuration SimpleAggregateFunction(max, Float64) CODEC(ZSTD(1))
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, RouterConfigVersion, OperationName, OperationType, ClientName, ClientVersion, OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE cosmo.operation_latency_metrics_5_30