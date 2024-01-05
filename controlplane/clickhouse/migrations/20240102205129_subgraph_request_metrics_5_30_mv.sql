-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.subgraph_request_metrics_5_30_mv TO cosmo.subgraph_request_metrics_5_30 AS
SELECT
    toStartOfFiveMinute(TimeUnix) AS Timestamp,
    toLowCardinality(Attributes [ 'wg.federated_graph.id']) AS FederatedGraphID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.subgraph.id' ]) AS SubgraphID,
    toUInt64(sum(Value)) as TotalRequests,
    toUInt64(sumIf(Value, position(Attributes['http.status_code'],'5') = 1 OR position(Attributes['http.status_code'],'4') = 1 OR mapContains(Attributes, 'wg.request.error'))) as TotalErrors
FROM
    cosmo.otel_metrics_sum
WHERE ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND IsMonotonic = true AND MetricName = 'router.http.requests' AND SubgraphID != '' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    FederatedGraphID,
    OrganizationID,
    SubgraphID,
    Timestamp
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.subgraph_request_metrics_5_30_mv;