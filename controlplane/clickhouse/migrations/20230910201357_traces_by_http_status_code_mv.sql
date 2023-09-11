-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_by_http_status_code_quarter_hourly_mv (
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
    HttpStatusCode String CODEC(ZSTD(1)),
    OrganizationID String CODEC(ZSTD(1)),
    FederatedGraphID String CODEC(ZSTD(1)),
    TotalRequests UInt64 CODEC(ZSTD(1)),
    DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    LastCalled DateTime('UTC') CODEC (ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, HttpStatusCode
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
SELECT
    toDateTime(
        toStartOfInterval(Timestamp, INTERVAL 15 Minute),
        'UTC'
    ) as Timestamp,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    SpanAttributes ['wg.organization.id'] as OrganizationID,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    count() AS TotalRequests,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toUnixTimestamp(MAX(Timestamp)) as LastCalled
FROM
    cosmo.otel_traces
WHERE empty(ParentSpanId)
GROUP BY
    Timestamp,
    HttpStatusCode,
    FederatedGraphID,
    OrganizationID
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_by_http_status_code_quarter_hourly_mv