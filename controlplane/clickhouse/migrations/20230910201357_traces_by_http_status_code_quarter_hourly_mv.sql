-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_by_http_status_code_quarter_hourly_mv TO cosmo.traces_by_http_status_code_quarter_hourly AS
SELECT
    toDateTime(
        toStartOfInterval(Timestamp, INTERVAL 15 Minute),
        'UTC'
    ) as Timestamp,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    if(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'), true, false) as HasError,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    toLowCardinality(SpanAttributes [ 'wg.federated_graph.id']) as FederatedGraphID,
    count() AS TotalRequests,
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
    HttpStatusCode,
    FederatedGraphID,
    OrganizationID,
    HasError
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_by_http_status_code_quarter_hourly_mv