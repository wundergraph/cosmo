-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.otel_spans_by_trace_mv TO cosmo.otel_spans_by_trace AS
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

-- migrate:down

DROP VIEW IF EXISTS cosmo.otel_spans_by_trace_mv
