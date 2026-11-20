-- migrate:up

-- Fills span_search from new spans only; trace search covers spans stored after this migration.
CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.span_search_mv TO cosmo.span_search AS
SELECT
    toLowCardinality(SpanAttributes ['wg.federated_graph.id']) as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Timestamp,
    TraceId,
    SpanId,
    ParentSpanId,
    SpanName,
    SpanKind,
    ServiceName,
    Duration,
    StatusCode,
    StatusMessage,
    SpanAttributes ['wg.router.root_span'] = 'true' OR SpanAttributes ['wg.component.name'] = 'router-server' as IsRoot,
    toLowCardinality(SpanAttributes ['wg.subgraph.name']) as SubgraphName,
    toLowCardinality(SpanAttributes ['wg.subgraph.id']) as SubgraphID,
    SpanAttributes ['wg.operation.name'] as OperationName,
    SpanAttributes ['wg.operation.hash'] as OperationHash,
    toLowCardinality(SpanAttributes ['wg.operation.type']) as OperationType,
    SpanAttributes ['wg.operation.persisted_id'] as OperationPersistedID,
    toLowCardinality(SpanAttributes ['wg.client.name']) as ClientName,
    toLowCardinality(SpanAttributes ['wg.client.version']) as ClientVersion,
    toLowCardinality(SpanAttributes ['http.status_code']) as HttpStatusCode,
    toLowCardinality(SpanAttributes ['wg.feature_flag']) as FeatureFlag,
    toLowCardinality(if(ResourceAttributes ['service.version'] != '', ResourceAttributes ['service.version'], SpanAttributes ['wg.router.version'])) as RouterVersion,
    toLowCardinality(SpanAttributes ['wg.router.cluster.name']) as ClusterName,
    ResourceAttributes ['service.instance.id'] as ServiceInstanceID,
    toLowCardinality(ResourceAttributes ['host.name']) as Hostname,
    SpanAttributes
FROM
    cosmo.otel_traces
WHERE
    SpanAttributes ['wg.federated_graph.id'] != '';

-- migrate:down

DROP VIEW IF EXISTS cosmo.span_search_mv;
