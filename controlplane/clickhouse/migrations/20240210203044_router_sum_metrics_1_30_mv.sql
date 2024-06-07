-- migrate:up

-- This view is used to forward the sum metrics from the otel_metrics_gauge table to the router_metrics_30 table

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.router_sum_metrics_1_30_mv TO cosmo.router_metrics_30 AS
SELECT
    toStartOfMinute(TimeUnix) as Timestamp,
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
    sum(Value) as MetricValue
FROM
    cosmo.otel_metrics_sum
WHERE
    ScopeName = 'cosmo.router.runtime'
GROUP BY
    Timestamp,
    ProcessID,
    ConfigVersionID,
    OrganizationID,
    FederatedGraphID,
    ServiceName,
    ServiceVersion,
    ServiceInstanceID,
    Hostname,
    ClusterName,
    MetricName
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.router_sum_metrics_1_30_mv