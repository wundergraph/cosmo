-- migrate:up

-- Feeds otel_spans_by_trace from otel_traces. This is the ONE trace MV that keeps every span
-- (no wg.router.root_span filter) — GetTrace needs the whole tree, not just the request row.
-- Spans are scoped to a graph/org by requiring wg.federated_graph.id (all cosmo spans carry it;
-- this matches the tenant filter GetTrace already applies and keeps non-cosmo spans out). A
-- TO-table MV's order is governed by the target, so no trailing ORDER BY. No Timestamp cut-line:
-- ingests from creation forward; history is backfilled (see
-- rfc/traces-analytics-performance/backfill_otel_spans_by_trace.sh).

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
