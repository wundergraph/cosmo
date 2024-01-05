-- migrate:up

CREATE TABLE IF NOT EXISTS traces (
   TraceId String CODEC (ZSTD(3)),
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   OperationName String CODEC (ZSTD(3)),
   OperationType LowCardinality(String) CODEC (ZSTD(3)),
   FederatedGraphID String CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   Duration Int64 CODEC(ZSTD(3)),
   StatusCode LowCardinality(String) CODEC (ZSTD(3)),
   HasError bool CODEC(ZSTD(3)),
   StatusMessage String CODEC (ZSTD(3)),
   OperationHash String CODEC (ZSTD(3)),
   OperationContent String CODEC (ZSTD(3)),
   OperationPersistedID String CODEC (ZSTD(3)),
   HttpStatusCode String CODEC (ZSTD(3)),
   HttpHost String CODEC (ZSTD(3)),
   HttpUserAgent String CODEC (ZSTD(3)),
   HttpMethod String CODEC (ZSTD(3)),
   HttpTarget String CODEC (ZSTD(3)),
   ClientName String CODEC (ZSTD(3)),
   ClientVersion String CODEC (ZSTD(3)),
   Subscription Bool CODEC(ZSTD(3)),

   -- Indexes
   INDEX idx_operation_name OperationName TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_operation_type OperationType TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
   INDEX idx_operation_persistent_id OperationPersistedID TYPE bloom_filter(0.001) GRANULARITY 1,
   INDEX idx_client_name ClientName TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_client_version ClientVersion TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by federated graph in the most efficient way
ORDER BY (
    FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp)
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces