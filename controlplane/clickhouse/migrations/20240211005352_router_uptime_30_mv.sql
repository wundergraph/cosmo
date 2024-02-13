-- migrate:up

-- This view is used to forward the data from the otel_metrics_sum table to the router_uptime_30 table

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.router_uptime_30_mv TO cosmo.router_uptime_30 AS
SELECT
    maxSimpleState(TimeUnix) as Timestamp,
    first_value(ResourceAttributes[ 'process.pid' ]) as ProcessID,
    toLowCardinality(Attributes [ 'wg.router.config.version' ]) as ConfigVersionID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.federated_graph.id' ]) as FederatedGraphID,
    first_value(toLowCardinality(ResourceAttributes[ 'service.name'])) as ServiceName,
    first_value(toLowCardinality(ResourceAttributes[ 'service.version' ])) as ServiceVersion,
    ResourceAttributes[ 'service.instance.id' ] as ServiceInstanceID,
    first_value(toLowCardinality(Attributes[ 'wg.router.cluster.name' ])) as ClusterName,
    first_value(toLowCardinality(ResourceAttributes[ 'host.name' ])) as Hostname,
    maxSimpleState(Value) as ProcessUptimeSeconds
FROM
    cosmo.otel_metrics_sum
WHERE
    ScopeName = 'cosmo.router.runtime' AND MetricName = 'runtime.uptime'
GROUP BY
    ConfigVersionID,
    OrganizationID,
    FederatedGraphID,
    ServiceInstanceID
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.router_uptime_30_mv