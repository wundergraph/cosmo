-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.operation_request_metrics_5_30_mv (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName String CODEC (ZSTD(1)),
   OperationHash String CODEC (ZSTD(1)),
   TotalRequests UInt64 CODEC(ZSTD(1)),
   TotalErrors UInt64 CODEC(ZSTD(1)),
   TotalClientErrors UInt64 CODEC(ZSTD(1)),
   OperationType String CODEC (ZSTD(1)),
   FederatedGraphID String CODEC(ZSTD(1)),
   RouterConfigVersion String CODEC(ZSTD(1)),
   OrganizationID String CODEC(ZSTD(1)),
   IsSubscription Bool CODEC(ZSTD(1)),
   ClientName String CODEC (ZSTD(1)),
   ClientVersion String CODEC (ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, RouterConfigVersion, OperationName, OperationType, ClientName, ClientVersion, IsSubscription, OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
SELECT
    toStartOfFiveMinute(TimeUnix) AS Timestamp,
    Attributes [ 'wg.operation.name' ] AS OperationName,
    Attributes [ 'wg.operation.hash' ] AS OperationHash,
    sum(Value) as TotalRequests,
    sumIf(Value, position(Attributes['http.status_code'],'5') = 1 OR position(Attributes['http.status_code'],'4') = 1) as TotalErrors,
    sumIf(Value, position(Attributes['http.status_code'],'4') = 1) AS TotalClientErrors,
    Attributes [ 'wg.operation.type' ] AS OperationType,
    Attributes [ 'wg.federated_graph.id'] AS FederatedGraphID,
    Attributes [ 'wg.router.config.version'] AS RouterConfigVersion,
    Attributes [ 'wg.organization.id' ] as OrganizationID,
    mapContains(Attributes, 'wg.subscription') AS IsSubscription,
    Attributes [ 'wg.client.name' ] AS ClientName,
    Attributes [ 'wg.client.version' ] AS ClientVersion
FROM
    cosmo.otel_metrics_sum
WHERE IsMonotonic = true AND MetricName = 'router.http.requests' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    OperationName,
    OperationHash,
    FederatedGraphID,
    RouterConfigVersion,
    OrganizationID,
    OperationType,
    Timestamp,
    IsSubscription,
    ClientName,
    ClientVersion
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.operation_request_metrics_5_30_mv