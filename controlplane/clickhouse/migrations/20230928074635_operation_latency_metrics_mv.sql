-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.operation_latency_metrics_5_30_mv (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName LowCardinality(String) CODEC (ZSTD(1)),
   OperationHash String CODEC (ZSTD(1)),
   OperationType LowCardinality(String) CODEC (ZSTD(1)),
   RouterConfigVersion LowCardinality(String) CODEC(ZSTD(1)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(1)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(1)),
   ClientName LowCardinality(String) CODEC (ZSTD(1)),
   ClientVersion LowCardinality(String) CODEC (ZSTD(1)),
   DurationQuantiles AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Float64) CODEC(ZSTD(1)),
   MaxDuration Float64 CODEC(ZSTD(1)),
   MinDuration Float64 CODEC(ZSTD(1)),
   IsSubscription Bool CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, RouterConfigVersion, OperationName, OperationType, ClientName, ClientVersion, OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
SELECT
    toStartOfFiveMinute(TimeUnix) as Timestamp,
    Attributes [ 'wg.operation.name' ] as OperationName,
    Attributes [ 'wg.operation.hash' ] as OperationHash,
    Attributes [ 'wg.operation.type' ] as OperationType,
    Attributes [ 'wg.router.config.version'] as RouterConfigVersion,
    Attributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    Attributes [ 'wg.organization.id' ] as OrganizationID,
    Attributes [ 'wg.client.name' ] as ClientName,
    Attributes [ 'wg.client.version' ] as ClientVersion,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Sum / Count) AS DurationQuantiles,
    max(Max) AS MaxDuration,
    min(Min) AS MinDuration,
    mapContains(Attributes, 'wg.subscription') as IsSubscription
FROM
    cosmo.otel_metrics_histogram
WHERE MetricName = 'router.http.request.duration_milliseconds' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    OperationName,
    OperationHash,
    FederatedGraphID,
    RouterConfigVersion,
    OrganizationID,
    OperationType,
    Timestamp,
    ClientName,
    ClientVersion,
    IsSubscription
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.operation_latency_metrics_5_30_mv