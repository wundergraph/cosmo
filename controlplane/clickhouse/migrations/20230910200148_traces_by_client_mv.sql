-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_by_client_quarter_hourly_mv (
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
    ClientName String CODEC (ZSTD(1)),
    ClientVersion String CODEC(ZSTD(1)),
    OrganizationID String CODEC(ZSTD(1)),
    FederatedGraphID String CODEC(ZSTD(1)),
    TotalRequests UInt64 CODEC(ZSTD(1)),
    TotalRequestsError UInt64 CODEC(ZSTD(1)),
    TotalRequestsOk UInt64 CODEC(ZSTD(1)),
    DurationQuantiles AggregateFunction(quantiles(0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    LastCalled DateTime('UTC') CODEC (ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), FederatedGraphID, OrganizationID, ClientName
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
SELECT
    toDateTime(
        toStartOfInterval(Timestamp, INTERVAL 15 Minute),
        'UTC'
    ) as Timestamp,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    SpanAttributes [ 'wg.client.version' ] as ClientVersion,
    SpanAttributes ['wg.organization.id'] as OrganizationID,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    count() AS TotalRequests,
    countIf(StatusCode = 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'4') = 1) AS TotalRequestsError,
    countIf(StatusCode != 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'4') != 1) AS TotalRequestsOk,
    quantilesState(0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toUnixTimestamp(MAX(Timestamp)) as LastCalled
FROM
    cosmo.otel_traces
WHERE empty(ParentSpanId)
AND SpanAttributes [ 'http.status_code' ] != '404'
GROUP BY
    Timestamp,
    ClientName,
    ClientVersion,
    FederatedGraphID,
    OrganizationID
ORDER BY
    TotalRequests DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_by_client_quarter_hourly_mv