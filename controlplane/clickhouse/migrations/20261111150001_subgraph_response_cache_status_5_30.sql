-- migrate:up

-- This table is used to aggregate the response cache status of subgraph fetches.
CREATE TABLE IF NOT EXISTS cosmo.subgraph_response_cache_status_5_30 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   SubgraphID LowCardinality(String) CODEC (ZSTD(3)),
   CacheStatus LowCardinality(String) CODEC (ZSTD(3)),
   -- Summed from delta points only. A cumulative point repeats its running total on every export, so summing it overcounts.
   TotalFetches UInt64 CODEC(ZSTD(3)),
   -- Points that were not delta. Tells a router that exports cumulative metrics apart from a router with no traffic.
   NonDeltaPoints UInt64 CODEC(ZSTD(3))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
-- Readers look up one organization and graph, then read every subgraph and status in a time window
ORDER BY (
    OrganizationID, FederatedGraphID, SubgraphID, CacheStatus, toUnixTimestamp(Timestamp)
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.subgraph_response_cache_status_5_30
