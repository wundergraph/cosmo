import { PlainMessage } from '@bufbuild/protobuf';
import { Span } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { timestampToNanoseconds } from './util.js';

export class TraceRepository {
  constructor(private client: ClickHouseClient) {}

  public async getTrace(
    traceID: string,
    spanID: string,
    organizationID: string,
    federatedGraphId: string,
  ): Promise<PlainMessage<Span>[]> {
    const columns = `
        Timestamp as timestamp,
        TraceId as traceId,
        SpanId as spanId,
        SpanKind as spanKind,
        ParentSpanId as parentSpanId,
        SpanName as spanName,
        Duration as duration,
        ServiceName as serviceName,
        StatusCode as statusCode,
        StatusMessage as statusMessage,
        ScopeName as scopeName,
        SpanAttributes['wg.operation.content'] as attrOperationContent,
        SpanAttributes['wg.operation.name'] as attrOperationName,
        SpanAttributes['http.status_code'] as attrHttpStatusCode,
        SpanAttributes['http.url'] as attrHttpUrl,
        SpanAttributes['wg.operation.type'] as attrWgOperationType,
        SpanAttributes['wg.component.name'] as attrWgComponentName,
        SpanAttributes['http.host'] as attrHttpHost,
        SpanAttributes['http.user_agent'] as attrHttpUserAgent,
        SpanAttributes['http.method'] as attrHttpMethod,
        SpanAttributes['http.target'] as attrHttpTarget,
        SpanAttributes['wg.subgraph.name'] as attrSubgraphName,
        SpanAttributes['wg.engine.plan_cache_hit'] as attrEnginePlanCacheHit,
        SpanAttributes['wg.engine.request_tracing_enabled'] as attrEngineRequestTracingEnabled,
        SpanAttributes['wg.operation.variables'] as attrOperationVariables,
        SpanAttributes['wg.engine.persisted_operation_cache_hit'] as attrPersistedOperationCacheHit,
        SpanAttributes['wg.engine.resolver.wait_time_ms'] as attrAcquireResolverWaitTimeMs,
        SpanAttributes['wg.engine.normalization_cache_hit'] as attrNormalizationCacheHit,
        SpanAttributes['wg.engine.validation_cache_hit'] as attrValidationCacheHit,
        SpanAttributes['wg.operation.hash'] as attrOperationHash,
        SpanAttributes['wg.organization.id'] as organizationId,
        SpanAttributes['wg.router.version'] as attrRouterVersion,
        SpanAttributes['wg.operation.persisted_id'] as attrOperationPersistedId,
        SpanAttributes['wg.federated_graph.id'] as attrFederatedGraphId,
        SpanAttributes['wg.operation.batching.is_batched'] as attrIsBatched,
        SpanAttributes['wg.operation.batching.operations_count'] as attrBatchedOperationsCount,
        SpanAttributes['wg.operation.batching.operation_index'] as attrWgBatchedOperationIndex
    `;

    const query = `
    WITH RECURSIVE spans AS (
      SELECT ${columns}
      FROM ${this.client.database}.otel_traces
      WHERE 
        TraceId = trace_id
        AND Timestamp >= start 
        AND Timestamp <= end
        AND SpanAttributes['wg.organization.id'] = '${organizationID}'
        AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
        AND spanId = '${spanID}'
      
      UNION ALL
      
      SELECT ${columns}
      FROM spans s, ${this.client.database}.otel_traces as t
      WHERE t.ParentSpanId = s.spanId 
        AND t.TraceId = trace_id
        AND t.Timestamp >= start
        AND t.Timestamp <= end
        AND t.SpanAttributes['wg.organization.id'] = '${organizationID}'
        AND t.SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
    ),
    '${traceID}' AS trace_id,
    (
        SELECT min(Start)
        FROM ${this.client.database}.otel_traces_trace_id_ts
        WHERE TraceId = trace_id
    ) AS start,
    (
        SELECT max(End) + 1
        FROM ${this.client.database}.otel_traces_trace_id_ts
        WHERE TraceId = trace_id
    ) AS end
    SELECT *
    FROM spans
    ORDER BY timestamp ASC
    LIMIT 100
    SETTINGS allow_experimental_analyzer = 1
    `;

    const results = await this.client.queryPromise(query);

    if (!Array.isArray(results)) {
      return [];
    }

    return results.map((result) => ({
      scopeName: result.scopeName,
      timestamp: timestampToNanoseconds(result.timestamp),
      traceID: result.traceId,
      spanID: result.spanId,
      parentSpanID: result.parentSpanId,
      spanName: result.spanName,
      spanKind: result.spanKind,
      duration: BigInt(result.duration),
      serviceName: result.serviceName,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      attributes: {
        httpStatusCode: result.attrHttpStatusCode,
        componentName: result.attrWgComponentName,
        operationName: result.attrOperationName,
        operationType: result.attrWgOperationType,
        operationContent: result.attrOperationContent,
        httpURL: result.attrHttpUrl,
        httpHost: result.attrHttpHost,
        httpUserAgent: result.attrHttpUserAgent,
        httpMethod: result.attrHttpMethod,
        httpTarget: result.attrHttpTarget,
        subgraphName: result.attrSubgraphName,
        enginePlanCacheHit: result.attrEnginePlanCacheHit,
        engineRequestTracingEnabled: result.attrEngineRequestTracingEnabled,
        operationVariables: result.attrOperationVariables,
        persistedOperationCacheHit: result.attrPersistedOperationCacheHit,
        acquireResolverWaitTimeMs: result.attrAcquireResolverWaitTimeMs,
        normalizationCacheHit: result.attrNormalizationCacheHit,
        validationCacheHit: result.attrValidationCacheHit,
        operationHash: result.attrOperationHash,
        organizationID: result.organizationId,
        routerVersion: result.attrRouterVersion,
        operationPersistedID: result.attrOperationPersistedId,
        federatedGraphID: result.attrFederatedGraphId,
        isBatched: result.attrIsBatched,
        batchedOperationsCount: result.attrBatchedOperationsCount,
        batchedOperationIndex: result.attrWgBatchedOperationIndex,
      },
    }));
  }
}
