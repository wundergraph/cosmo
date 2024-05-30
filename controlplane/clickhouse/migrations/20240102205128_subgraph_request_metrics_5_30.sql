-- migrate:up

-- This table is used to aggregate subgraph request metrics.
CREATE TABLE IF NOT EXISTS cosmo.subgraph_request_metrics_5_30 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   OperationName LowCardinality(String) CODEC (ZSTD(3)),
   OperationHash String CODEC (ZSTD(3)),
   OperationPersistedID String CODEC (ZSTD(3)),
   OperationType LowCardinality(String) CODEC (ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   SubgraphID LowCardinality(String) CODEC (ZSTD(3)),
   TotalRequests UInt64 CODEC(ZSTD(3)),
   TotalErrors UInt64 CODEC(ZSTD(3)),
   TotalClientErrors UInt64 CODEC(ZSTD(3)),
   ClientName LowCardinality(String) CODEC (ZSTD(3)),
   ClientVersion LowCardinality(String) CODEC (ZSTD(3)),
   RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)),
   IsSubscription Bool CODEC(ZSTD(3))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch request metrics by subgraph ID in the most efficient way
ORDER BY (
    SubgraphID, FederatedGraphID, OrganizationID, OperationName, OperationType, ClientName, ClientVersion, toUnixTimestamp(Timestamp), RouterConfigVersion, IsSubscription, OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.subgraph_request_metrics_5_30