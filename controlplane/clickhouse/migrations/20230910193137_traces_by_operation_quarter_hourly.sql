-- migrate:up

CREATE TABLE IF NOT EXISTS cosmo.traces_by_operation_quarter_hourly (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName String CODEC (ZSTD(1)),
   OperationType String CODEC (ZSTD(1)),
   FederatedGraphID String CODEC(ZSTD(1)),
   OrganizationID String CODEC(ZSTD(1)),
   IsSubscription Bool CODEC(ZSTD(1)),
   TotalRequests UInt64 CODEC(ZSTD(1)),
   TotalRequestsError UInt64 CODEC(ZSTD(1)),
   TotalRequestsOk UInt64 CODEC(ZSTD(1)),
   DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
   LastCalled DateTime('UTC') CODEC (ZSTD(1))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, OperationName, OperationType
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces_by_operation_quarter_hourly