-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_by_client_quarter_hourly_mv TO cosmo.traces_by_client_quarter_hourly AS
SELECT
    toDateTime(
        toStartOfInterval(Timestamp, INTERVAL 15 Minute),
        'UTC'
    ) as Timestamp,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    SpanAttributes [ 'wg.client.version' ] as ClientVersion,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    toLowCardinality(SpanAttributes [ 'wg.federated_graph.id']) as FederatedGraphID,
    count() AS TotalRequests,
    countIf(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error')) AS TotalRequestsError,
    countIf(not(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'))) AS TotalRequestsOk,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toDateTime(MAX(Timestamp), 'UTC') as LastCalled
FROM
    cosmo.otel_traces
WHERE
    -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true' OR
    -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
GROUP BY
    Timestamp,
    ClientName,
    ClientVersion,
    FederatedGraphID,
    OrganizationID
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_by_client_quarter_hourly_mv