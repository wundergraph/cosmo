-- migrate:up

-- This table is used to aggregate subgraph latency metrics.

CREATE TABLE IF NOT EXISTS cosmo.subgraph_latency_metrics_5_30 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   SubgraphID String CODEC (ZSTD(3)),
   BucketCounts AggregateFunction(sumForEach, Array(UInt64)) CODEC(ZSTD(3)),
   ExplicitBounds Array(Float64) CODEC(ZSTD(3)),
   Sum SimpleAggregateFunction(sum, Float64) CODEC(ZSTD(3)),
   Count SimpleAggregateFunction(sum, UInt64) CODEC(ZSTD(3)),
   MinDuration SimpleAggregateFunction(min, Float64) CODEC(ZSTD(3)),
   MaxDuration SimpleAggregateFunction(max, Float64) CODEC(ZSTD(3))
) ENGINE = AggregatingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch latency metrics by subgraph ID in the most efficient way
ORDER BY (
    SubgraphID, FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp)
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.subgraph_latency_metrics_5_30