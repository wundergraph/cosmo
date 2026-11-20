-- migrate:up

-- otelcollector >= 0.109 writes OTel spec names for span status and kind ('Error', 'Server')
-- instead of the protobuf enum names ('STATUS_CODE_ERROR', 'SPAN_KIND_SERVER'). The control plane
-- and Studio match on the enum names, and the last 30 days of data use them too. These views map
-- the new names back to the enum names, so nothing downstream has to change. Values that already
-- use the enum names pass through unchanged, so old and new collectors can write at the same time.

ALTER TABLE cosmo.traces_mv MODIFY QUERY
SELECT
    TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    toLowCardinality(SpanAttributes [ 'wg.operation.type' ]) as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Duration,
    toLowCardinality(transform(StatusCode, ['Unset', 'Ok', 'Error'], ['STATUS_CODE_UNSET', 'STATUS_CODE_OK', 'STATUS_CODE_ERROR'], StatusCode)) as StatusCode,
    if(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'), true, false) as HasError,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
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
    -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true' OR
    -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
ORDER BY
    Timestamp DESC;

-- migrate:down

ALTER TABLE cosmo.traces_mv MODIFY QUERY
SELECT
    TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    toLowCardinality(SpanAttributes [ 'wg.operation.type' ]) as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Duration,
    toLowCardinality(StatusCode) as StatusCode,
    if(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'), true, false) as HasError,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
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
    -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true' OR
    -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
ORDER BY
    Timestamp DESC;
