/**
 * The SQL behind each dataset of the shared analytics catalog (`@wundergraph/cosmo-shared`). Every expression here
 * is static: user values only ever reach SQL as typed parameters, added by the compiler.
 */

export type SourceKey = 'main' | 'latency';

export interface SourceTable {
  table: string;
  /** The time column the window applies to; null for tables without a usable time bound. */
  timeColumn: string | null;
  /** Predicates every query on this table carries, besides the tenant and the window. */
  where?: string[];
  /** A stored time bucket in the sort key that queries must filter on for the window to prune (span_search). */
  bucketColumn?: string;
}

/** How a virtual dimension is resolved through Postgres. */
export type VirtualKind = 'graph' | 'subgraph' | 'featureFlag' | 'composition';

export interface PhysicalDimension {
  /** Expression for grouping and filtering. */
  sql: string;
  /** The column holds an array: filters test membership, grouping uses arrayJoin (and can double-count). */
  array?: boolean;
  virtual?: VirtualKind;
}

export interface PhysicalMeasure {
  sql: string;
  source: SourceKey;
  /** Post-processing of the raw value. */
  kind: 'number' | 'datetime' | 'string';
}

export interface PhysicalDataset {
  name: string;
  sources: Partial<Record<SourceKey, SourceTable>>;
  dimensions: Record<string, PhysicalDimension>;
  measures: Record<string, PhysicalMeasure>;
  /** `attr:<key>` dimensions read this map column. */
  attributeMap?: string;
  /** The measure used for counts in GetAnalyticsDimensionValues and for `includeInactive` zero rows. */
  countMeasure: string;
  /** Run `EXPLAIN ESTIMATE` against the row budget before executing. */
  rowBudget?: boolean;
  /** The subgraph key leads these tables: narrowing to the organization's subgraphs prunes other tenants. */
  subgraphKeyColumn?: string;
}

const histogramQuantile = (quantile: number, scale = 1) => {
  const counts = 'sumForEachMerge(BucketCounts)';
  const rank = `func_rank(${quantile}, ${counts})`;
  const value = `func_histogram_v2(${rank}, func_rank_bucket_lower_index(${rank}, ${counts}), ${counts}, anyLast(ExplicitBounds))`;
  return `round(${scale === 1 ? value : `${value} / ${scale}`}, 2)`;
};

const LATENCY_MEASURES = (prefix: string): Record<string, PhysicalMeasure> => ({
  [`${prefix}Avg`]: {
    sql: 'if(sum(Count) > 0, round(sum(Sum) / sum(Count), 2), 0)',
    source: 'latency',
    kind: 'number',
  },
  [`${prefix}Min`]: { sql: 'round(min(MinDuration), 2)', source: 'latency', kind: 'number' },
  [`${prefix}Max`]: { sql: 'round(max(MaxDuration), 2)', source: 'latency', kind: 'number' },
  [`${prefix}P50`]: { sql: histogramQuantile(0.5), source: 'latency', kind: 'number' },
  [`${prefix}P75`]: { sql: histogramQuantile(0.75), source: 'latency', kind: 'number' },
  [`${prefix}P90`]: { sql: histogramQuantile(0.9), source: 'latency', kind: 'number' },
  [`${prefix}P95`]: { sql: histogramQuantile(0.95), source: 'latency', kind: 'number' },
  [`${prefix}P99`]: { sql: histogramQuantile(0.99), source: 'latency', kind: 'number' },
});

const SEEN = (source: SourceKey, column = 'Timestamp'): Record<string, PhysicalMeasure> => ({
  firstSeen: { sql: `toUnixTimestamp(min(${column}))`, source, kind: 'datetime' },
  lastSeen: { sql: `toUnixTimestamp(max(${column}))`, source, kind: 'datetime' },
});

const REQUEST_COUNTS = (source: SourceKey): Record<string, PhysicalMeasure> => ({
  requests: { sql: 'sum(TotalRequests)', source, kind: 'number' },
  // Requests per minute of the window, or of the time bucket when grouping by time.
  rpm: { sql: 'round(sum(TotalRequests) / {rpmMinutes:Float64}, 4)', source, kind: 'number' },
  errors: { sql: 'sum(TotalErrors)', source, kind: 'number' },
  clientErrors: { sql: 'sum(TotalClientErrors)', source, kind: 'number' },
  errorRate: {
    sql: 'if(sum(TotalRequests) > 0, round(sum(TotalErrors) / sum(TotalRequests) * 100, 2), 0)',
    source,
    kind: 'number',
  },
});

const OPERATION_DIMENSIONS: Record<string, PhysicalDimension> = {
  operationName: { sql: 'OperationName' },
  operationHash: { sql: 'OperationHash' },
  operationType: { sql: 'OperationType' },
  clientName: { sql: 'ClientName' },
  clientVersion: { sql: 'ClientVersion' },
};

const COMPOSED_DIMENSIONS = (versionColumn: string): Record<string, PhysicalDimension> => ({
  routerConfigVersion: { sql: versionColumn },
  featureFlag: { sql: versionColumn, virtual: 'featureFlag' },
  composition: { sql: versionColumn, virtual: 'composition' },
  graph: { sql: 'FederatedGraphID', virtual: 'graph' },
});

const SPAN_DURATION_MEASURES: Record<string, PhysicalMeasure> = {
  durationAvg: { sql: 'round(avg(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationMin: { sql: 'round(min(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationMax: { sql: 'round(max(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationP50: { sql: 'round(quantileExact(0.5)(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationP75: { sql: 'round(quantileExact(0.75)(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationP90: { sql: 'round(quantileExact(0.9)(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationP95: { sql: 'round(quantileExact(0.95)(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationP99: { sql: 'round(quantileExact(0.99)(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  durationSum: { sql: 'round(sum(Duration) / 1e6, 3)', source: 'main', kind: 'number' },
  exampleTraceId: { sql: 'argMax(TraceId, Duration)', source: 'main', kind: 'string' },
};

const INTROSPECTION = "(startsWith(FieldName, '__') OR arrayExists(t -> startsWith(t, '__'), TypeNames))";

const FIELD_USAGE_DIMENSIONS: Record<string, PhysicalDimension> = {
  kind: { sql: "multiIf(IsArgument, 'argument', IsInput, 'input', 'field')" },
  fieldName: { sql: 'FieldName' },
  typeName: { sql: 'TypeNames', array: true },
  path: { sql: "arrayStringConcat(Path, '.')" },
  namedType: { sql: 'NamedType' },
  pathDepth: { sql: 'length(Path)' },
  isIntrospection: { sql: INTROSPECTION },
  ...OPERATION_DIMENSIONS,
  subgraph: { sql: 'SubgraphIDs', array: true, virtual: 'subgraph' },
  ...COMPOSED_DIMENSIONS('RouterConfigVersion'),
};

const OPERATION_METRICS: PhysicalDataset = {
  name: 'operation_metrics',
  sources: {
    main: { table: 'operation_request_metrics_5_30', timeColumn: 'Timestamp' },
    latency: { table: 'operation_latency_metrics_5_30', timeColumn: 'Timestamp' },
  },
  dimensions: { ...OPERATION_DIMENSIONS, ...COMPOSED_DIMENSIONS('RouterConfigVersion') },
  measures: {
    ...REQUEST_COUNTS('main'),
    ...LATENCY_MEASURES('latency'),
    latencySum: { sql: 'round(sum(Sum), 2)', source: 'latency', kind: 'number' },
    distinctHashes: { sql: 'uniqExact(OperationHash)', source: 'main', kind: 'number' },
    ...SEEN('main'),
  },
  countMeasure: 'requests',
};

const SUBGRAPH_METRICS: PhysicalDataset = {
  name: 'subgraph_metrics',
  sources: {
    main: { table: 'subgraph_request_metrics_5_30', timeColumn: 'Timestamp' },
    latency: { table: 'subgraph_latency_metrics_5_30', timeColumn: 'Timestamp' },
  },
  dimensions: {
    subgraph: { sql: 'SubgraphID', virtual: 'subgraph' },
    ...OPERATION_DIMENSIONS,
    ...COMPOSED_DIMENSIONS('RouterConfigVersion'),
  },
  measures: {
    ...REQUEST_COUNTS('main'),
    ...LATENCY_MEASURES('latency'),
    latencySum: { sql: 'round(sum(Sum), 2)', source: 'latency', kind: 'number' },
    ...SEEN('main'),
  },
  countMeasure: 'requests',
  subgraphKeyColumn: 'SubgraphID',
};

const PLANNING_METRICS: PhysicalDataset = {
  name: 'planning_metrics',
  sources: { latency: { table: 'operation_planning_metrics_5_30', timeColumn: 'Timestamp' } },
  dimensions: { ...OPERATION_DIMENSIONS, ...COMPOSED_DIMENSIONS('RouterConfigVersion') },
  measures: {
    plans: { sql: 'sum(Count)', source: 'latency', kind: 'number' },
    ...LATENCY_MEASURES('planning'),
    ...SEEN('latency'),
  },
  countMeasure: 'plans',
};

const REQUEST_VOLUME: PhysicalDataset = {
  name: 'request_volume',
  sources: { main: { table: 'gql_metrics_router_requests', timeColumn: 'Timestamp' } },
  dimensions: { graph: { sql: 'FederatedGraphID', virtual: 'graph' } },
  measures: { requests: { sql: 'sum(RequestCount)', source: 'main', kind: 'number' }, ...SEEN('main') },
  countMeasure: 'requests',
};

const REQUEST_MEASURES: Record<string, PhysicalMeasure> = {
  count: { sql: 'count()', source: 'main', kind: 'number' },
  errors: { sql: 'countIf(HasError)', source: 'main', kind: 'number' },
  errorRate: { sql: 'if(count() > 0, round(countIf(HasError) / count() * 100, 2), 0)', source: 'main', kind: 'number' },
  ...SPAN_DURATION_MEASURES,
  ...SEEN('main'),
};

/** Requests from the root rows of `traces_detail_by_time`: the fast path when only its columns are used. */
const REQUESTS: PhysicalDataset = {
  name: 'requests',
  sources: { main: { table: 'traces_detail_by_time', timeColumn: 'Timestamp' } },
  dimensions: {
    ...OPERATION_DIMENSIONS,
    persistedOperationId: { sql: 'OperationPersistedID' },
    httpStatusCode: { sql: 'HttpStatusCode' },
    httpMethod: { sql: 'HttpMethod' },
    httpHost: { sql: 'HttpHost' },
    httpTarget: { sql: 'HttpTarget' },
    userAgent: { sql: 'HttpUserAgent' },
    hasError: { sql: 'HasError' },
    statusMessage: { sql: 'StatusMessage' },
    durationMs: { sql: 'Duration / 1e6' },
  },
  measures: REQUEST_MEASURES,
  countMeasure: 'count',
  rowBudget: true,
};

const SPAN_ERROR = "StatusCode = 'STATUS_CODE_ERROR'";
/** A root span's error rule: an error status, an HTTP 4xx/5xx, or a GraphQL request error. */
export const ROOT_HAS_ERROR = `(${SPAN_ERROR} OR startsWith(HttpStatusCode, '4') OR startsWith(HttpStatusCode, '5') OR mapContains(SpanAttributes, 'wg.request.error'))`;

const SPAN_SEARCH_DIMENSIONS: Record<string, PhysicalDimension> = {
  ...OPERATION_DIMENSIONS,
  featureFlag: { sql: 'FeatureFlag' },
  routerVersion: { sql: 'RouterVersion' },
  clusterName: { sql: 'ClusterName' },
  serviceInstanceId: { sql: 'ServiceInstanceID' },
  hostname: { sql: 'Hostname' },
  durationMs: { sql: 'Duration / 1e6' },
  statusMessage: { sql: 'StatusMessage' },
  attributeKeys: { sql: 'mapKeys(SpanAttributes)', array: true },
};

/** Requests read from the root rows of `span_search`, when a query needs a root-span attribute. */
const REQUESTS_FROM_ROOT_SPANS: PhysicalDataset = {
  name: 'requests',
  sources: { main: { table: 'span_search', timeColumn: 'Timestamp', bucketColumn: 'TimeBucket', where: ['IsRoot'] } },
  dimensions: {
    ...SPAN_SEARCH_DIMENSIONS,
    persistedOperationId: { sql: 'OperationPersistedID' },
    httpStatusCode: { sql: 'HttpStatusCode' },
    httpMethod: { sql: "SpanAttributes['http.method']" },
    httpHost: { sql: "SpanAttributes['http.host']" },
    httpTarget: { sql: "SpanAttributes['http.target']" },
    userAgent: { sql: "SpanAttributes['http.user_agent']" },
    hasError: { sql: ROOT_HAS_ERROR },
    protocol: { sql: "SpanAttributes['wg.operation.protocol']" },
    isBatched: { sql: "SpanAttributes['wg.operation.batching.is_batched'] = 'true'" },
  },
  measures: {
    ...REQUEST_MEASURES,
    errors: { sql: `countIf(${ROOT_HAS_ERROR})`, source: 'main', kind: 'number' },
    errorRate: {
      sql: `if(count() > 0, round(countIf(${ROOT_HAS_ERROR}) / count() * 100, 2), 0)`,
      source: 'main',
      kind: 'number',
    },
  },
  attributeMap: 'SpanAttributes',
  countMeasure: 'count',
  rowBudget: true,
};

const SPANS: PhysicalDataset = {
  name: 'spans',
  sources: { main: { table: 'span_search', timeColumn: 'Timestamp', bucketColumn: 'TimeBucket' } },
  dimensions: {
    ...SPAN_SEARCH_DIMENSIONS,
    spanName: { sql: 'SpanName' },
    spanKind: { sql: 'SpanKind' },
    serviceName: { sql: 'ServiceName' },
    subgraphName: { sql: 'SubgraphName' },
    subgraphId: { sql: 'SubgraphID' },
    statusCode: { sql: 'StatusCode' },
    isRoot: { sql: 'IsRoot' },
    hasError: { sql: SPAN_ERROR },
  },
  measures: {
    count: { sql: 'count()', source: 'main', kind: 'number' },
    errors: { sql: `countIf(${SPAN_ERROR})`, source: 'main', kind: 'number' },
    errorRate: {
      sql: `if(count() > 0, round(countIf(${SPAN_ERROR}) / count() * 100, 2), 0)`,
      source: 'main',
      kind: 'number',
    },
    traces: { sql: 'uniqExact(TraceId)', source: 'main', kind: 'number' },
    ...SPAN_DURATION_MEASURES,
    ...SEEN('main'),
  },
  attributeMap: 'SpanAttributes',
  countMeasure: 'count',
  rowBudget: true,
};

const FIELD_USAGE: PhysicalDataset = {
  name: 'field_usage',
  sources: { main: { table: 'gql_metrics_schema_usage_5m_90d', timeColumn: 'Timestamp' } },
  dimensions: FIELD_USAGE_DIMENSIONS,
  measures: {
    usages: { sql: 'sum(TotalUsages)', source: 'main', kind: 'number' },
    errorUsages: { sql: 'sum(TotalErrors)', source: 'main', kind: 'number' },
    clientErrorUsages: { sql: 'sum(TotalClientErrors)', source: 'main', kind: 'number' },
    operations: { sql: 'uniqExact(OperationHash)', source: 'main', kind: 'number' },
    clients: { sql: 'uniqExact(ClientName, ClientVersion)', source: 'main', kind: 'number' },
    ...SEEN('main'),
  },
  countMeasure: 'usages',
};

const SCHEMA_PRESENCE: PhysicalDataset = {
  name: 'schema_presence',
  sources: { main: { table: 'gql_metrics_schema_usage_lite_1d_90d', timeColumn: 'Timestamp' } },
  dimensions: FIELD_USAGE_DIMENSIONS,
  measures: {
    daysUsed: { sql: 'uniqExact(toDate(Timestamp))', source: 'main', kind: 'number' },
    operations: { sql: 'uniqExact(OperationHash)', source: 'main', kind: 'number' },
    clients: { sql: 'uniqExact(ClientName, ClientVersion)', source: 'main', kind: 'number' },
    ...SEEN('main'),
  },
  countMeasure: 'daysUsed',
};

const ROUTER_RUNTIME: PhysicalDataset = {
  name: 'router_runtime',
  sources: { main: { table: 'router_metrics_30', timeColumn: 'Timestamp' } },
  dimensions: {
    metricName: { sql: 'MetricName' },
    serviceInstanceId: { sql: 'ServiceInstanceID' },
    hostname: { sql: 'Hostname' },
    clusterName: { sql: 'ClusterName' },
    routerVersion: { sql: 'ServiceVersion' },
    serviceName: { sql: 'ServiceName' },
    processId: { sql: 'ProcessID' },
    configVersion: { sql: 'ConfigVersionID' },
    composition: { sql: 'ConfigVersionID', virtual: 'composition' },
    graph: { sql: 'FederatedGraphID', virtual: 'graph' },
  },
  measures: {
    avg: { sql: 'round(avg(MetricValue), 4)', source: 'main', kind: 'number' },
    min: { sql: 'min(MetricValue)', source: 'main', kind: 'number' },
    max: { sql: 'max(MetricValue)', source: 'main', kind: 'number' },
    last: { sql: 'argMax(MetricValue, Timestamp)', source: 'main', kind: 'number' },
    samples: { sql: 'count()', source: 'main', kind: 'number' },
    processes: { sql: 'uniqExact(ProcessID)', source: 'main', kind: 'number' },
    ...SEEN('main'),
  },
  countMeasure: 'samples',
};

/**
 * Operation documents. `gql_metrics_operations` has no usable time bound (a document is written once and rewritten at
 * most every 30 days), so the compiler restricts it to hashes with schema-usage traffic inside the window, the same
 * rule `GetOperationContent` applies.
 */
const OPERATION_DOCUMENTS: PhysicalDataset = {
  name: 'operation_documents',
  sources: { main: { table: 'gql_metrics_operations', timeColumn: null } },
  dimensions: {
    operationHash: { sql: 'OperationHash' },
    operationName: { sql: 'OperationName' },
    operationType: { sql: 'OperationType' },
    content: { sql: 'OperationContent' },
    graph: { sql: 'FederatedGraphID', virtual: 'graph' },
  },
  measures: {
    document: { sql: 'any(OperationContent)', source: 'main', kind: 'string' },
    operations: { sql: 'uniqExact(OperationHash)', source: 'main', kind: 'number' },
  },
  countMeasure: 'operations',
};

export const PHYSICAL_DATASETS: PhysicalDataset[] = [
  OPERATION_METRICS,
  SUBGRAPH_METRICS,
  PLANNING_METRICS,
  REQUEST_VOLUME,
  REQUESTS,
  SPANS,
  FIELD_USAGE,
  SCHEMA_PRESENCE,
  ROUTER_RUNTIME,
  OPERATION_DOCUMENTS,
];

/** The `requests` variant read from root spans; picked when a query uses a field only root spans carry. */
export const REQUESTS_ROOT_SPANS = REQUESTS_FROM_ROOT_SPANS;

/** Hidden dimensions: usable by GetAnalyticsDimensionValues and the compiler, but not part of the public catalog. */
export const HIDDEN_DIMENSIONS = new Set(['attributeKeys']);

/** Filter-only defaults: introspection is excluded from usage datasets unless the query filters on it. */
export const INTROSPECTION_SQL = INTROSPECTION;

export const findPhysicalDataset = (name: string) => PHYSICAL_DATASETS.find((dataset) => dataset.name === name);
