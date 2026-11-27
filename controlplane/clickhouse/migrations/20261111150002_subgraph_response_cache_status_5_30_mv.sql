-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.subgraph_response_cache_status_5_30_mv TO cosmo.subgraph_response_cache_status_5_30 AS
SELECT
    toStartOfFiveMinute(TimeUnix) AS Timestamp,
    toLowCardinality(Attributes [ 'wg.federated_graph.id']) AS FederatedGraphID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.subgraph.id' ]) AS SubgraphID,
    toLowCardinality(Attributes [ 'wg.response_cache.status' ]) AS CacheStatus,
    -- AggTemp 1 is AGGREGATION_TEMPORALITY_DELTA, see https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/metrics/v1/metrics.proto
    toUInt64(sumIf(Value, AggTemp = 1)) as TotalFetches,
    countIf(AggTemp != 1) as NonDeltaPoints
FROM
    cosmo.otel_metrics_sum
WHERE
    ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND IsMonotonic = true AND MetricName = 'router.http.requests' AND SubgraphID != '' AND OrganizationID != '' AND FederatedGraphID != '' AND CacheStatus != ''
GROUP BY
    OrganizationID,
    FederatedGraphID,
    SubgraphID,
    CacheStatus,
    Timestamp
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.subgraph_response_cache_status_5_30_mv
