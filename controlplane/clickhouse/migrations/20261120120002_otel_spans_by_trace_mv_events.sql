-- migrate:up

-- Copy the events and resource attributes into otel_spans_by_trace. MODIFY QUERY swaps the view's query in place,
-- so no span is lost between dropping and recreating the view.
ALTER TABLE cosmo.otel_spans_by_trace_mv MODIFY QUERY
SELECT
    SpanAttributes ['wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    TraceId,
    Timestamp,
    SpanId,
    ParentSpanId,
    SpanName,
    SpanKind,
    ServiceName,
    Duration,
    StatusCode,
    StatusMessage,
    ScopeName,
    SpanAttributes,
    ResourceAttributes,
    Events.Timestamp,
    Events.Name,
    Events.Attributes
FROM
    cosmo.otel_traces
WHERE
    SpanAttributes ['wg.federated_graph.id'] != '';

-- migrate:down

ALTER TABLE cosmo.otel_spans_by_trace_mv MODIFY QUERY
SELECT
    SpanAttributes ['wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    TraceId,
    Timestamp,
    SpanId,
    ParentSpanId,
    SpanName,
    SpanKind,
    ServiceName,
    Duration,
    StatusCode,
    StatusMessage,
    ScopeName,
    SpanAttributes
FROM
    cosmo.otel_traces
WHERE
    SpanAttributes ['wg.federated_graph.id'] != '';
