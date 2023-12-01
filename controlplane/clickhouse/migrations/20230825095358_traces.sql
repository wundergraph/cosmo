-- migrate:up

CREATE TABLE IF NOT EXISTS traces (
   TraceId String CODEC (ZSTD(1)),
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName String CODEC (ZSTD(1)),
   OperationType String CODEC (ZSTD(1)),
   FederatedGraphID String CODEC(ZSTD(1)),
   OrganizationID String CODEC(ZSTD(1)),
   Duration Int64 CODEC(ZSTD(1)),
   StatusCode LowCardinality(String) CODEC (ZSTD(1)),
   HasError bool CODEC(ZSTD(1)),
   StatusMessage String CODEC (ZSTD(1)),
   OperationHash String CODEC (ZSTD(1)),
   OperationContent String CODEC (ZSTD(1)),
   OperationPersistedID String CODEC (ZSTD(1)),
   HttpStatusCode String CODEC (ZSTD(1)),
   HttpHost String CODEC (ZSTD(1)),
   HttpUserAgent String CODEC (ZSTD(1)),
   HttpMethod String CODEC (ZSTD(1)),
   HttpTarget String CODEC (ZSTD(1)),
   ClientName String CODEC (ZSTD(1)),
   ClientVersion String CODEC (ZSTD(1)),
   Subscription Bool CODEC(ZSTD(1))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, OperationName, OperationType
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces