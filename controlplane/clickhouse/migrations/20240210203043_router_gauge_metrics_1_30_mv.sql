-- migrate:up

-- This view is used to forward the runtime router gauge metrics from the otel_metrics_gauge table to the router_metrics_30 table
-- Data can't be aggregated because the metrics can be cumulative or delta.

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.router_gauge_metrics_1_30_mv TO cosmo.router_metrics_30 AS
SELECT
    TimeUnix as Timestamp,
    ResourceAttributes[ 'process.pid' ] as ProcessID,
    toLowCardinality(Attributes [ 'wg.router.config.version' ]) as ConfigVersionID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.federated_graph.id' ]) as FederatedGraphID,
    toLowCardinality(ResourceAttributes[ 'service.name']) as ServiceName,
    toLowCardinality(ResourceAttributes[ 'service.version' ]) as ServiceVersion,
    ResourceAttributes[ 'service.instance.id' ] as ServiceInstanceID,
    toLowCardinality(Attributes[ 'wg.router.cluster.name' ]) as ClusterName,
    toLowCardinality(ResourceAttributes[ 'host.name' ]) as Hostname,
    toLowCardinality(MetricName) as MetricName,
    Value as MetricValue
FROM
    cosmo.otel_metrics_gauge
WHERE
    ScopeName = 'cosmo.router.runtime'
ORDER BY
    TimeUnix DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.router_gauge_metrics_1_30_mv