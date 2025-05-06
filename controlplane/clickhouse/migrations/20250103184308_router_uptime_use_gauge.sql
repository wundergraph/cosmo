-- migrate:up

-- Previously we used the `runtime.uptime` metric from the sum aggregation table to calculate the uptime of the router.
-- This is not correct because it is not a sum metric, but a gauge metric. We are only interested in the last value of the uptime.
-- This migration changes the query to use the `process.uptime` metric from the gauge aggregation table.

ALTER TABLE cosmo.router_uptime_30_mv MODIFY QUERY
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
        first_value(Value) as ProcessUptimeSeconds
    FROM
        cosmo.otel_metrics_gauge
    WHERE
        ScopeName = 'cosmo.router.runtime' AND MetricName = 'process.uptime'
    GROUP BY
        ConfigVersionID,
        OrganizationID,
        FederatedGraphID,
        ServiceInstanceID
    ORDER BY
        Timestamp DESC;

-- migrate:down

ALTER TABLE cosmo.router_uptime_30_mv MODIFY QUERY
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