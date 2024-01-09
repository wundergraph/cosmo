
-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.subgraph_latency_metrics_5_30_mv TO cosmo.subgraph_latency_metrics_5_30 AS
-- Aggregate histogram buckets into a 5 minute window, Counts are summed, Min/Max are taken
SELECT
    toStartOfFiveMinute(TimeUnix) as Timestamp,
    toLowCardinality(Attributes [ 'wg.federated_graph.id']) as FederatedGraphID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.subgraph.id' ]) AS SubgraphID,
    -- Sum up the bucket counts on the same index which produces the overall count of samples of the histogram
    sumForEachState(BucketCounts) as BucketCounts,
    -- Populate the bounds so we have a base value for quantile calculations
    ExplicitBounds,
    sumSimpleState(Sum) AS Sum,
    sumSimpleState(Count) AS Count,
    minSimpleState(Min) AS MinDuration,
    maxSimpleState(Max) AS MaxDuration
FROM otel_metrics_histogram
-- Only works with the same bounds for all buckets. If bounds are different, we can't add them together
WHERE ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND MetricName = 'router.http.request.duration_milliseconds' AND SubgraphID != '' AND OrganizationID != '' AND FederatedGraphID != ''
GROUP BY
    FederatedGraphID,
    OrganizationID,
    Timestamp,
    SubgraphID,
    ExplicitBounds
ORDER BY
    Timestamp;

-- migrate:down

DROP VIEW IF EXISTS cosmo.subgraph_latency_metrics_5_30_mv;