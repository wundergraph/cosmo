-- migrate:up

-- Same columns, engine and TTL as operation_request_metrics_5_30, but sorted graph-first: every query on it
-- filters by graph, organization and time. OperationPersistedID joins the key so rows with different
-- persisted IDs no longer merge into one. operation_request_metrics_5_30_v2_mv fills it alongside
-- operation_request_metrics_5_30. Once it holds a full 30-day TTL window, the controlplane reads it instead and
-- operation_request_metrics_5_30 is dropped.
CREATE TABLE IF NOT EXISTS cosmo.operation_request_metrics_5_30_v2 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   OperationName LowCardinality(String) CODEC (ZSTD(3)),
   OperationHash String CODEC (ZSTD(3)),
   OperationPersistedID String CODEC (ZSTD(3)),
   TotalRequests UInt64 CODEC(ZSTD(3)),
   TotalErrors UInt64 CODEC(ZSTD(3)),
   TotalClientErrors UInt64 CODEC(ZSTD(3)),
   OperationType LowCardinality(String) CODEC (ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   IsSubscription Bool CODEC(ZSTD(3)),
   ClientName LowCardinality(String) CODEC (ZSTD(3)),
   ClientVersion LowCardinality(String) CODEC (ZSTD(3))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp), OperationName, ClientName, ClientVersion, RouterConfigVersion, OperationType, IsSubscription, OperationHash, OperationPersistedID
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.operation_request_metrics_5_30_v2
