-- migrate:up

-- This table is used to aggregate traces by status code and provide request counts and duration quantiles

CREATE TABLE IF NOT EXISTS cosmo.traces_by_http_status_code_quarter_hourly (
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
    HttpStatusCode String CODEC(ZSTD(3)),
    HasError bool CODEC(ZSTD(3)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    FederatedGraphID String CODEC(ZSTD(3)),
    TotalRequests UInt64 CODEC(ZSTD(3)),
    DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(3)),
    LastCalled DateTime('UTC') CODEC (ZSTD(3))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by federated graph ID efficiently. Using status code as the first column
-- would not be very efficient because there is a large number of requests with the same status code and different graph IDs.
ORDER BY (
    FederatedGraphID, HttpStatusCode, OrganizationID, toUnixTimestamp(Timestamp), HasError
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.traces_by_http_status_code_quarter_hourly