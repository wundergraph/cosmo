import { Span } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { traced } from '../../tracing.js';
import type { PlainMessage } from '../../../types/index.js';
import { timestampToNanoseconds } from './util.js';
import type { SummarySpan } from './traceSummary.js';

/** Spans read for one trace at most; a trace that large is truncated to `maxSpans` in any case. */
const READ_LIMIT = 5000;

/** The attributes Studio reads from `Span.attributes`, by their OpenTelemetry keys. */
const STUDIO_ATTRIBUTES: Record<string, string> = {
  httpStatusCode: 'http.status_code',
  componentName: 'wg.component.name',
  operationName: 'wg.operation.name',
  operationType: 'wg.operation.type',
  operationContent: 'wg.operation.content',
  httpURL: 'http.url',
  httpHost: 'http.host',
  httpUserAgent: 'http.user_agent',
  httpMethod: 'http.method',
  httpTarget: 'http.target',
  subgraphName: 'wg.subgraph.name',
  enginePlanCacheHit: 'wg.engine.plan_cache_hit',
  engineRequestTracingEnabled: 'wg.engine.request_tracing_enabled',
  operationVariables: 'wg.operation.variables',
  persistedOperationCacheHit: 'wg.engine.persisted_operation_cache_hit',
  acquireResolverWaitTimeMs: 'wg.engine.resolver.wait_time_ms',
  normalizationCacheHit: 'wg.engine.normalization_cache_hit',
  validationCacheHit: 'wg.engine.validation_cache_hit',
  operationHash: 'wg.operation.hash',
  routerVersion: 'wg.router.version',
  operationPersistedID: 'wg.operation.persisted_id',
  isBatched: 'wg.operation.batching.is_batched',
  operationProtocol: 'wg.operation.protocol',
  batchedOperationsCount: 'wg.operation.batching.operations_count',
  batchedOperationIndex: 'wg.operation.batching.operation_index',
};

interface SpanRow {
  timestamp: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  spanName: string;
  spanKind: string;
  duration: string | number;
  serviceName: string;
  statusCode: string;
  statusMessage: string;
  scopeName: string;
  organizationId: string;
  federatedGraphId: string;
  rawAttributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  eventTimestamps: string[];
  eventNames: string[];
  eventAttributes: Record<string, string>[];
}

export interface TraceRead {
  spans: PlainMessage<Span>[];
  /** Every span read (up to the read limit, not only the returned ones), shaped for summarizeTrace. */
  summarySpans: SummarySpan[];
  truncated: boolean;
  totalSpans: number;
  /** False when the spans predate events and resource attributes being kept. */
  eventsAvailable: boolean;
}

@traced
export class TraceRepository {
  constructor(private client: ClickHouseClient) {}

  /**
   * Reads one trace by the table's sort key (graph, organization, trace ID) inside the tracing retention, so a trace
   * of another tenant, or outside retention, reads exactly like an unknown one. With a span ID, returns that span and
   * its descendants (what Studio shows); without one, the whole trace.
   */
  public async getTrace(input: {
    traceId: string;
    spanId?: string;
    organizationId: string;
    federatedGraphId: string;
    retentionDays: number;
    maxSpans: number;
  }): Promise<TraceRead> {
    const query = `
      SELECT
        Timestamp as timestamp,
        TraceId as traceId,
        SpanId as spanId,
        ParentSpanId as parentSpanId,
        SpanName as spanName,
        SpanKind as spanKind,
        Duration as duration,
        ServiceName as serviceName,
        StatusCode as statusCode,
        StatusMessage as statusMessage,
        ScopeName as scopeName,
        OrganizationID as organizationId,
        FederatedGraphID as federatedGraphId,
        SpanAttributes as rawAttributes,
        ResourceAttributes as resourceAttributes,
        Events.Timestamp as eventTimestamps,
        Events.Name as eventNames,
        Events.Attributes as eventAttributes
      FROM ${this.client.database}.otel_spans_by_trace
      WHERE FederatedGraphID = {federatedGraphId:String}
        AND OrganizationID = {organizationId:String}
        AND TraceId = {traceId:String}
        AND Timestamp >= now() - toIntervalDay({retentionDays:UInt32})
      ORDER BY Timestamp ASC
      LIMIT {readLimit:UInt32}
    `;
    const result = await this.client.queryPromise<SpanRow>(query, {
      traceId: input.traceId,
      organizationId: input.organizationId,
      federatedGraphId: input.federatedGraphId,
      retentionDays: input.retentionDays,
      readLimit: READ_LIMIT,
    });
    let rows: SpanRow[] = Array.isArray(result) ? result : [];

    if (input.spanId) {
      rows = subtree(rows, input.spanId);
    }
    // The summary covers every span read, so the critical path and late errors survive truncating the span list.
    return {
      spans: rows.slice(0, input.maxSpans).map((row) => toSpan(row)),
      summarySpans: rows.map((row) => toSummarySpan(row)),
      truncated: rows.length > input.maxSpans,
      totalSpans: rows.length,
      eventsAvailable: rows.some((row) => Object.keys(row.resourceAttributes ?? {}).length > 0),
    };
  }
}

function subtree(rows: SpanRow[], spanId: string): SpanRow[] {
  const children = new Map<string, SpanRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentSpanId) ?? [];
    siblings.push(row);
    children.set(row.parentSpanId, siblings);
  }
  const start = rows.find((row) => row.spanId === spanId);
  if (!start) {
    return [];
  }
  const selected = new Set<SpanRow>();
  const queue = [start];
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (selected.has(row)) {
      continue;
    }
    selected.add(row);
    queue.push(...(children.get(row.spanId) ?? []));
  }
  return rows.filter((row) => selected.has(row));
}

function events(row: SpanRow) {
  return (row.eventNames ?? []).map((name, index) => ({
    timestamp: timestampToNanoseconds(row.eventTimestamps[index]),
    name,
    attributes: row.eventAttributes?.[index] ?? {},
  }));
}

function toSpan(row: SpanRow): PlainMessage<Span> {
  const raw = row.rawAttributes ?? {};
  return {
    scopeName: row.scopeName,
    timestamp: timestampToNanoseconds(row.timestamp),
    traceID: row.traceId,
    spanID: row.spanId,
    parentSpanID: row.parentSpanId,
    spanName: row.spanName,
    spanKind: row.spanKind,
    duration: BigInt(row.duration),
    serviceName: row.serviceName,
    statusCode: row.statusCode,
    statusMessage: row.statusMessage,
    rawAttributes: raw,
    resourceAttributes: row.resourceAttributes ?? {},
    events: events(row),
    attributes: {
      ...Object.fromEntries(Object.entries(STUDIO_ATTRIBUTES).map(([name, key]) => [name, raw[key] ?? ''])),
      organizationID: row.organizationId,
      federatedGraphID: row.federatedGraphId,
    },
  };
}

function toSummarySpan(row: SpanRow): SummarySpan {
  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    spanName: row.spanName,
    start: timestampToNanoseconds(row.timestamp),
    durationNs: BigInt(row.duration),
    statusCode: row.statusCode,
    statusMessage: row.statusMessage,
    attributes: row.rawAttributes ?? {},
    events: events(row).map((event) => ({ name: event.name, attributes: event.attributes })),
  };
}
