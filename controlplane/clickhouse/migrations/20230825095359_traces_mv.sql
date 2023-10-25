-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_mv TO cosmo.traces AS
SELECT
    TraceId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    SpanAttributes [ 'wg.operation.type' ] as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    SpanAttributes ['wg.organization.id'] as OrganizationID,
    Duration,
    StatusCode,
    if(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'), true, false) as HasError,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    SpanAttributes [ 'http.host' ] as HttpHost,
    SpanAttributes [ 'http.user_agent' ] as HttpUserAgent,
    SpanAttributes [ 'http.method' ] as HttpMethod,
    SpanAttributes [ 'http.target' ] as HttpTarget,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    SpanAttributes [ 'wg.client.version' ] as ClientVersion,
    mapContains(SpanAttributes, 'wg.subscription') as Subscription
FROM
    cosmo.otel_traces
WHERE
    empty(ParentSpanId)
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_mv