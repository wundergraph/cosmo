import { PlainMessage } from '@bufbuild/protobuf';
import { Span } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { getDateRange, isoDateRangeToTimestamps, timestampToNanoseconds } from './util.js';

export class TraceRepository {
  constructor(private client: ClickHouseClient) {}

  public async getTrace(traceID: string, organizationID: string): Promise<PlainMessage<Span>[]> {
    const query = `
    WITH '${traceID}' AS trace_id,
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
    SELECT  
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
        SpanAttributes['wg.subgraph.name'] as attrSubgraphName
    FROM ${this.client.database}.otel_traces
    WHERE (TraceId = trace_id) AND (Timestamp >= start) AND (Timestamp <= end) AND SpanAttributes['wg.organization.id'] = '${organizationID}'
    ORDER BY Timestamp ASC
    `;

    const results = await this.client.queryPromise(query);

    if (!Array.isArray(results)) {
      return [];
    }

    return results.map((result) => ({
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
      },
    }));
  }

  public async getRouterVersion(organizationID: string, startDate: string): Promise<string> {
    const parsedDateRange = isoDateRangeToTimestamps({ start: startDate, end: '' });
    const [start] = getDateRange(parsedDateRange);

    const queryWithTimeConstraint = `
    WITH 
      toDateTime('${start}') AS startDate
    SELECT  
        SpanAttributes['wg.router.version'] as routerVersion
    FROM ${this.client.database}.otel_traces
    WHERE Timestamp >= startDate AND SpanAttributes['wg.router.version'] != '' AND SpanAttributes['wg.organization.id'] = '${organizationID}' 
    ORDER BY Timestamp ASC
    LIMIT 1 OFFSET 0
    `;

    const res = await this.client.queryPromise(queryWithTimeConstraint);

    if (Array.isArray(res)) {
      return res?.[0]?.routerVersion || '';
    }

    return res;
  }
}
