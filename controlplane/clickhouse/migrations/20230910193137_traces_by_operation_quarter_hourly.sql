-- migrate:up

-- This table is used to aggregate traces by operation name and count the number of requests.

CREATE TABLE IF NOT EXISTS cosmo.traces_by_operation_quarter_hourly (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   OperationName String CODEC (ZSTD(3)),
   OperationType LowCardinality(String) CODEC (ZSTD(3)),
   FederatedGraphID String CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   IsSubscription Bool CODEC(ZSTD(3)),
   TotalRequests UInt64 CODEC(ZSTD(3)),
   TotalRequestsError UInt64 CODEC(ZSTD(3)),
   TotalRequestsOk UInt64 CODEC(ZSTD(3)),
   DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(3)),
   LastCalled DateTime('UTC') CODEC (ZSTD(3))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by client name in the most efficient way
ORDER BY (
    OperationName, FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp), OperationType, IsSubscription
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces_by_operation_quarter_hourly