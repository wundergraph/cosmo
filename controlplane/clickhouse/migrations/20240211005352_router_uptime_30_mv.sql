-- migrate:up

-- This view is used to forward the data from the otel_metrics_sum table to the router_uptime_30 table

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.router_uptime_30_mv TO cosmo.router_uptime_30 AS
SELECT
    maxSimpleState(TimeUnix) as Timestamp,
    ResourceAttributes[ 'process.pid' ] as ProcessID,
    toLowCardinality(Attributes [ 'wg.router.config.version' ]) as ConfigVersionID,
    toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
    toLowCardinality(Attributes [ 'wg.federated_graph.id' ]) as FederatedGraphID,
    toLowCardinality(ResourceAttributes[ 'service.name']) as ServiceName,
    toLowCardinality(ResourceAttributes[ 'service.version' ]) as ServiceVersion,
    ResourceAttributes[ 'service.instance.id' ] as ServiceInstanceID,
    toLowCardinality(Attributes[ 'wg.router.cluster.name' ]) as ClusterName,
    ResourceAttributes[ 'host.name' ] as Hostname,
    maxSimpleState(Value) as UptimeSeconds
FROM
    cosmo.otel_metrics_sum
WHERE
    ScopeName = 'cosmo.router.runtime' AND MetricName = 'runtime.uptime'
GROUP BY
    ProcessID,
    ConfigVersionID,
    OrganizationID,
    FederatedGraphID,
    ServiceInstanceID,
    ServiceName,
    ServiceVersion,
    Hostname,
    ClusterName
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.router_uptime_30_mv