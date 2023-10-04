
-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.operation_latency_metrics_5_30_mv (
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
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
-- Aggregate histogram buckets into a 5 minute window, Counts are summed, Min/Max are taken
SELECT
    toStartOfFiveMinute(TimeUnix) as Timestamp,
    Attributes [ 'wg.operation.name' ] as OperationName,
    Attributes [ 'wg.operation.hash' ] as OperationHash,
    Attributes [ 'wg.operation.type' ] as OperationType,
    Attributes [ 'wg.router.config.version'] as RouterConfigVersion,
    Attributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    Attributes [ 'wg.organization.id' ] as OrganizationID,
    Attributes [ 'wg.client.name' ] as ClientName,
    Attributes [ 'wg.client.version' ] as ClientVersion,
    -- Sum up the bucket counts on the same index which produces the overall count of samples of the histogram
    sumForEachState(BucketCounts) as BucketCounts,
    -- Populate the bounds so we have a base value for quantile calculations
    ExplicitBounds,
    sumSimpleState(Sum) AS Sum,
    sumSimpleState(Count) AS Count,
    minSimpleState(Min) AS MinDuration,
    maxSimpleState(Max) AS MaxDuration
FROM otel_metrics_histogram
-- Only works with the same bounds for all buckets. If bounds are different, we can't add them together
WHERE MetricName = 'router.http.request.duration_milliseconds' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    OperationName,
    OperationHash,
    FederatedGraphID,
    RouterConfigVersion,
    OrganizationID,
    OperationType,
    Timestamp,
    ClientName,
    ClientVersion,
    ExplicitBounds
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.operation_latency_metrics_5_30_mv