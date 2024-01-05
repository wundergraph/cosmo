-- migrate:up

CREATE TABLE IF NOT EXISTS cosmo.traces_by_client_quarter_hourly (
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
    ClientName String CODEC (ZSTD(3)),
    ClientVersion String CODEC(ZSTD(3)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    FederatedGraphID String CODEC(ZSTD(3)),
    TotalRequests UInt64 CODEC(ZSTD(3)),
    TotalRequestsError UInt64 CODEC(ZSTD(3)),
    TotalRequestsOk UInt64 CODEC(ZSTD(3)),
    DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(3)),
    LastCalled DateTime('UTC') CODEC (ZSTD(3))
) ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by client name in the most efficient way
ORDER BY (
    ClientName, ClientVersion, OrganizationID, FederatedGraphID, toUnixTimestamp(Timestamp)
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces_by_client_quarter_hourly