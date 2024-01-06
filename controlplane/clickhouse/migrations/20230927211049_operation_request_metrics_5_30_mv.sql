-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.operation_request_metrics_5_30_mv TO cosmo.operation_request_metrics_5_30 AS
SELECT
    toStartOfFiveMinute(TimeUnix) AS Timestamp,
    toLowCardinality(Attributes [ 'wg.operation.name' ]) AS OperationName,
    Attributes [ 'wg.operation.hash' ] AS OperationHash,
    Attributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
    toUInt64(sum(Value)) as TotalRequests,
    toUInt64(sumIf(Value, position(Attributes['http.status_code'],'5') = 1 OR position(Attributes['http.status_code'],'4') = 1 OR mapContains(Attributes, 'wg.request.error'))) as TotalErrors,
    toUInt64(sumIf(Value, position(Attributes['http.status_code'],'4') = 1)) AS TotalClientErrors,
    toLowCardinality(Attributes [ 'wg.operation.type' ]) AS OperationType,
    toLowCardinality(Attributes [ 'wg.federated_graph.id']) AS FederatedGraphID,
    toLowCardinality(Attributes [ 'wg.router.config.version']) AS RouterConfigVersion,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    mapContains(Attributes, 'wg.subscription') AS IsSubscription,
    toLowCardinality(Attributes [ 'wg.client.name' ]) AS ClientName,
    toLowCardinality(Attributes [ 'wg.client.version' ]) AS ClientVersion
FROM
    cosmo.otel_metrics_sum
WHERE ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND IsMonotonic = true AND MetricName = 'router.http.requests' AND Attributes [ 'wg.subgraph.id' ] = '' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    OperationName,
    OperationHash,
    OperationPersistedID,
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