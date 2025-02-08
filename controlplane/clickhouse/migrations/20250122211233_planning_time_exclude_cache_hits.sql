-- migrate:up

ALTER TABLE cosmo.operation_planning_metrics_5_30_mv MODIFY QUERY
    SELECT
        toStartOfFiveMinute(TimeUnix) as Timestamp,
        toLowCardinality(Attributes [ 'wg.operation.name' ]) as OperationName,
        Attributes [ 'wg.operation.hash' ] as OperationHash,
        toLowCardinality(Attributes [ 'wg.operation.type' ]) as OperationType,
        Attributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
        toLowCardinality(Attributes [ 'wg.router.config.version']) as RouterConfigVersion,
        toLowCardinality(Attributes [ 'wg.federated_graph.id']) as FederatedGraphID,
        toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
        toLowCardinality(Attributes [ 'wg.client.name' ]) as ClientName,
        toLowCardinality(Attributes [ 'wg.client.version' ]) as ClientVersion,
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
    WHERE ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND MetricName = 'router.graphql.operation.planning_time' AND Attributes['wg.engine.plan_cache_hit'] == 'false' AND OrganizationID != '' AND FederatedGraphID != ''
    GROUP BY
        OperationName,
        OperationHash,
        OperationPersistedID,
        FederatedGraphID,
        RouterConfigVersion,
        OrganizationID,
        OperationType,
        Timestamp,
        ClientName,
        ClientVersion,
        ExplicitBounds
    ORDER BY
        Timestamp;

-- migrate:down

ALTER TABLE cosmo.operation_planning_metrics_5_30_mv MODIFY QUERY
    SELECT
        toStartOfFiveMinute(TimeUnix) as Timestamp,
        toLowCardinality(Attributes [ 'wg.operation.name' ]) as OperationName,
        Attributes [ 'wg.operation.hash' ] as OperationHash,
        toLowCardinality(Attributes [ 'wg.operation.type' ]) as OperationType,
        Attributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
        toLowCardinality(Attributes [ 'wg.router.config.version']) as RouterConfigVersion,
        toLowCardinality(Attributes [ 'wg.federated_graph.id']) as FederatedGraphID,
        toLowCardinality(Attributes [ 'wg.organization.id' ]) as OrganizationID,
        toLowCardinality(Attributes [ 'wg.client.name' ]) as ClientName,
        toLowCardinality(Attributes [ 'wg.client.version' ]) as ClientVersion,
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
    WHERE ScopeName = 'cosmo.router' AND ScopeVersion = '0.0.1' AND MetricName = 'router.graphql.operation.planning_time' AND OrganizationID != '' AND FederatedGraphID != ''
    GROUP BY
        OperationName,
        OperationHash,
        OperationPersistedID,
        FederatedGraphID,
        RouterConfigVersion,
        OrganizationID,
        OperationType,
        Timestamp,
        ClientName,
        ClientVersion,
        ExplicitBounds
    ORDER BY
        Timestamp;
