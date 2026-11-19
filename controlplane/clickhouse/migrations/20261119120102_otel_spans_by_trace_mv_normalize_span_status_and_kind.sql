-- migrate:up

-- See 20261119120100_traces_mv_normalize_span_status.sql for why the status and kind names are mapped.

ALTER TABLE cosmo.otel_spans_by_trace_mv MODIFY QUERY
SELECT
    SpanAttributes ['wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    TraceId,
    Timestamp,
    SpanId,
    ParentSpanId,
    SpanName,
    transform(SpanKind, ['Unspecified', 'Internal', 'Server', 'Client', 'Producer', 'Consumer'], ['SPAN_KIND_UNSPECIFIED', 'SPAN_KIND_INTERNAL', 'SPAN_KIND_SERVER', 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER', 'SPAN_KIND_CONSUMER'], SpanKind) as SpanKind,
    ServiceName,
    Duration,
    transform(StatusCode, ['Unset', 'Ok', 'Error'], ['STATUS_CODE_UNSET', 'STATUS_CODE_OK', 'STATUS_CODE_ERROR'], StatusCode) as StatusCode,
    StatusMessage,
    ScopeName,
    SpanAttributes
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
