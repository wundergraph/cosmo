/**
 * The analytics dataset catalog: what `QueryAnalytics` can answer, described without SQL.
 * The controlplane attaches the SQL for each entry; the MCP tools generate their documentation from it.
 */

export type AnalyticsOperatorName =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'exists';

export type AnalyticsValueType = 'string' | 'number' | 'boolean' | 'datetime';

export type AnalyticsCompleteness = 'complete' | 'sampled';

export type AnalyticsRetentionFeature = 'analytics-retention' | 'tracing-retention';

export interface AnalyticsDimensionDescriptor {
  name: string;
  description: string;
  type: AnalyticsValueType;
  operators: AnalyticsOperatorName[];
  /** False for dimensions that can only filter, e.g. a row-level duration. */
  groupable: boolean;
  /** Resolved through Postgres (graph, subgraph, feature flag, composition). */
  virtual?: boolean;
}

export interface AnalyticsMeasureDescriptor {
  name: string;
  description: string;
  unit: 'count' | 'ms' | 'percent' | 'per_minute' | 'datetime' | 'days' | 'value' | 'text' | 'trace_id';
}

export interface AnalyticsDatasetDescriptor {
  name: string;
  description: string;
  grain: string;
  completeness: AnalyticsCompleteness;
  retentionFeature: AnalyticsRetentionFeature;
  storageTtlDays: number;
  dimensions: AnalyticsDimensionDescriptor[];
  measures: AnalyticsMeasureDescriptor[];
  defaultMeasures: string[];
  /** Allowed `timeBucket` values; empty when the dataset has no time series. */
  timeBuckets: string[];
  /** Whether any stored span attribute can be used as `attr:<key>`. */
  attributeDimensions: boolean;
  /** Measures that take a parameter, written as `name:<value>`. */
  parameterizedMeasures: { pattern: string; description: string }[];
  /** Dimensions whose `includeInactive` rows come from an inventory (zero rows for members with no traffic). */
  inventoryDimensions: string[];
  caveats: string[];
}

const STRING_OPS: AnalyticsOperatorName[] = ['eq', 'neq', 'in', 'not_in', 'contains', 'starts_with'];
const EXACT_OPS: AnalyticsOperatorName[] = ['eq', 'neq', 'in', 'not_in'];
const NUMBER_OPS: AnalyticsOperatorName[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'];
const BOOL_OPS: AnalyticsOperatorName[] = ['eq'];

const defaultOperators = (type: AnalyticsValueType) => {
  if (type === 'string') {
    return STRING_OPS;
  }
  return type === 'boolean' ? BOOL_OPS : NUMBER_OPS;
};

const dim = (
  name: string,
  description: string,
  type: AnalyticsValueType = 'string',
  options: { operators?: AnalyticsOperatorName[]; groupable?: boolean; virtual?: boolean } = {},
): AnalyticsDimensionDescriptor => ({
  name,
  description,
  type,
  operators: options.operators ?? defaultOperators(type),
  groupable: options.groupable ?? true,
  ...(options.virtual ? { virtual: true } : {}),
});

const measure = (
  name: string,
  description: string,
  unit: AnalyticsMeasureDescriptor['unit'],
): AnalyticsMeasureDescriptor => ({ name, description, unit });

const GRAPH = dim('graph', 'The federated graph (name). Use with `allGraphs` to compare graphs.', 'string', {
  operators: EXACT_OPS,
  virtual: true,
});
const FEATURE_FLAG = dim(
  'featureFlag',
  'The feature flag that served the request ("" = the base graph). Resolved from the router config version.',
  'string',
  { operators: EXACT_OPS, virtual: true },
);
const COMPOSITION = dim(
  'composition',
  'The composition (schema version ID) the router ran; rows also carry its creation time and flag.',
  'string',
  { operators: EXACT_OPS, virtual: true },
);
const OPERATION_DIMS = [
  dim('operationName', 'Operation name ("" for anonymous operations).'),
  dim('operationHash', 'Hash of the normalized operation body, without its name.', 'string', { operators: EXACT_OPS }),
  dim('operationType', 'query, mutation or subscription.', 'string', { operators: EXACT_OPS }),
  dim('clientName', 'Client name header ("unknown" when missing).'),
  dim('clientVersion', 'Client version header ("missing" when missing).'),
];
const LATENCY_MEASURES = (prefix: string, what: string) => [
  measure(`${prefix}Avg`, `Exact average ${what} (sum ÷ count).`, 'ms'),
  measure(`${prefix}Min`, `Minimum ${what}.`, 'ms'),
  measure(`${prefix}Max`, `Maximum ${what}.`, 'ms'),
  measure(`${prefix}P50`, `Median ${what}, interpolated from the histogram (capped at 10s).`, 'ms'),
  measure(`${prefix}P75`, `75th percentile ${what} (histogram, capped at 10s).`, 'ms'),
  measure(`${prefix}P90`, `90th percentile ${what} (histogram, capped at 10s).`, 'ms'),
  measure(`${prefix}P95`, `95th percentile ${what} (histogram, capped at 10s).`, 'ms'),
  measure(`${prefix}P99`, `99th percentile ${what} (histogram, capped at 10s).`, 'ms'),
];
const SEEN_MEASURES = [
  measure('firstSeen', 'First time bucket with data in the window.', 'datetime'),
  measure('lastSeen', 'Last time bucket with data in the window.', 'datetime'),
];
const METRIC_BUCKETS = ['5m', '15m', '1h', '6h', '1d'];
const SAMPLED_BUCKETS = ['1m', '5m', '15m', '1h', '6h', '1d'];
const SPAN_DURATION_MEASURES = [
  measure('durationAvg', 'Average duration (exact over the sample).', 'ms'),
  measure('durationMin', 'Minimum duration.', 'ms'),
  measure('durationMax', 'Maximum duration.', 'ms'),
  measure('durationP50', 'Median duration (exact over the sample, no 10s cap).', 'ms'),
  measure('durationP75', '75th percentile duration (exact over the sample).', 'ms'),
  measure('durationP90', '90th percentile duration (exact over the sample).', 'ms'),
  measure('durationP95', '95th percentile duration (exact over the sample).', 'ms'),
  measure('durationP99', '99th percentile duration (exact over the sample).', 'ms'),
  measure('durationSum', 'Total time.', 'ms'),
  measure('exampleTraceId', 'The trace ID of the slowest matching row (open it with get_trace).', 'trace_id'),
];
const FIELD_USAGE_DIMS = [
  dim('kind', 'field, argument or input.', 'string', { operators: EXACT_OPS }),
  dim('fieldName', 'Field, argument or input field name.'),
  dim(
    'typeName',
    'A possible parent type. An interface field expands to its implementations, so grouping by type can double-count.',
  ),
  dim('path', 'Dotted path, e.g. `Query.orders` or for arguments `orders.first`.'),
  dim('namedType', 'The named return or input type.'),
  dim('pathDepth', 'Path length; 1 = root fields (Query, Mutation, Subscription entry points).', 'number'),
  dim('isIntrospection', 'Introspection usage. Excluded unless you filter on this dimension.', 'boolean', {
    groupable: true,
  }),
  ...OPERATION_DIMS,
  dim('subgraph', 'A subgraph that serves the field (name).', 'string', { operators: EXACT_OPS, virtual: true }),
  dim('routerConfigVersion', 'Router config version (schema version ID).', 'string', { operators: EXACT_OPS }),
  FEATURE_FLAG,
  COMPOSITION,
  GRAPH,
];

export const ANALYTICS_DATASETS: AnalyticsDatasetDescriptor[] = [
  {
    name: 'operation_metrics',
    description:
      'Router request metrics per operation and client: every HTTP request (complete), in 5-minute buckets. Use for counts, rates, errors and latency.',
    grain: '5m',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 30,
    dimensions: [
      ...OPERATION_DIMS,
      dim('routerConfigVersion', 'Router config version (schema version ID).', 'string', { operators: EXACT_OPS }),
      FEATURE_FLAG,
      COMPOSITION,
      GRAPH,
    ],
    measures: [
      measure('requests', 'Number of requests.', 'count'),
      measure('rpm', 'Requests per minute over the window or bucket.', 'per_minute'),
      measure('errors', 'Requests with an HTTP 4xx/5xx status or a GraphQL request error.', 'count'),
      measure('clientErrors', 'Requests with an HTTP 4xx status.', 'count'),
      measure('errorRate', 'errors ÷ requests × 100.', 'percent'),
      ...LATENCY_MEASURES('latency', 'request latency'),
      measure('latencySum', 'Total request time (latency × volume).', 'ms'),
      measure('distinctHashes', 'Distinct operation hashes (one name sent in many shapes).', 'count'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['requests', 'errorRate', 'latencyP95'],
    timeBuckets: METRIC_BUCKETS,
    attributeDimensions: false,
    parameterizedMeasures: [
      {
        pattern: 'requestsOver:<ms>',
        description:
          'Requests slower than <ms>; exact only at histogram bucket bounds (e.g. 100, 250, 500, 1000, 2500, 5000, 10000).',
      },
    ],
    inventoryDimensions: ['graph', 'featureFlag'],
    caveats: [
      'No WebSocket subscriptions.',
      'Latency percentiles at or above 10s read as 10000ms; use the requests dataset for exact tail latency.',
      'Persisted operation IDs are not reliable here until the M8 cut-over; use the requests dataset.',
    ],
  },
  {
    name: 'subgraph_metrics',
    description:
      'Subgraph fetch metrics (complete): one row per fetch from the router to a subgraph, in 5-minute buckets.',
    grain: '5m',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 30,
    dimensions: [
      dim('subgraph', 'The subgraph (name).', 'string', { operators: EXACT_OPS, virtual: true }),
      ...OPERATION_DIMS,
      dim('routerConfigVersion', 'Router config version (schema version ID).', 'string', { operators: EXACT_OPS }),
      FEATURE_FLAG,
      COMPOSITION,
      GRAPH,
    ],
    measures: [
      measure('requests', 'Number of fetches (one client request can fetch a subgraph several times).', 'count'),
      measure('rpm', 'Fetches per minute.', 'per_minute'),
      measure('errors', 'Fetches with an error.', 'count'),
      measure('clientErrors', 'Fetches with an HTTP 4xx status.', 'count'),
      measure('errorRate', 'errors ÷ requests × 100.', 'percent'),
      ...LATENCY_MEASURES('latency', 'fetch latency'),
      measure('latencySum', 'Total fetch time.', 'ms'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['requests', 'errorRate', 'latencyP95'],
    timeBuckets: METRIC_BUCKETS,
    attributeDimensions: false,
    parameterizedMeasures: [{ pattern: 'requestsOver:<ms>', description: 'Fetches slower than <ms> (bucket bounds).' }],
    inventoryDimensions: ['graph', 'subgraph', 'featureFlag'],
    caveats: ['Counts fetches, not client requests.', 'Retries of one fetch count once.'],
  },
  {
    name: 'planning_metrics',
    description: 'Query-planning time (complete, plan-cache misses only, includes cache warm-up), in 5-minute buckets.',
    grain: '5m',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 30,
    dimensions: [
      ...OPERATION_DIMS,
      dim('routerConfigVersion', 'Router config version (schema version ID).', 'string', { operators: EXACT_OPS }),
      FEATURE_FLAG,
      COMPOSITION,
      GRAPH,
    ],
    measures: [
      measure('plans', 'Number of plans computed (plan-cache misses).', 'count'),
      ...LATENCY_MEASURES('planning', 'planning time'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['plans', 'planningP95'],
    timeBuckets: METRIC_BUCKETS,
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: ['graph', 'featureFlag'],
    caveats: ['Plan-cache hits are not recorded; a spike after a publish is expected (new composition, empty cache).'],
  },
  {
    name: 'request_volume',
    description:
      'Request volume per graph and day (complete): every request including WebSocket subscriptions and requests that fail before normalization.',
    grain: '1d',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 90,
    dimensions: [GRAPH],
    measures: [measure('requests', 'Number of requests.', 'count'), ...SEEN_MEASURES],
    defaultMeasures: ['requests'],
    timeBuckets: ['1d', '7d', '30d'],
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: ['graph'],
    caveats: ['Daily granularity only.'],
  },
  {
    name: 'requests',
    description:
      'Individual requests from sampled traces (root spans): exact percentiles over the sample, HTTP details, any root-span attribute.',
    grain: 'request',
    completeness: 'sampled',
    retentionFeature: 'tracing-retention',
    storageTtlDays: 30,
    dimensions: [
      ...OPERATION_DIMS,
      dim('persistedOperationId', 'Persisted operation ID the client sent.'),
      dim('httpStatusCode', 'HTTP status code.', 'string', { operators: EXACT_OPS }),
      dim('httpMethod', 'HTTP method (GET or POST).', 'string', { operators: EXACT_OPS }),
      dim('httpHost', 'HTTP host.'),
      dim('httpTarget', 'HTTP target (path and query).'),
      dim('userAgent', 'User agent.'),
      dim('hasError', 'The request failed (HTTP 4xx/5xx or a GraphQL request error).', 'boolean'),
      dim('statusMessage', 'Span status message (often the error).'),
      dim('durationMs', 'Request duration (row filter).', 'number', { groupable: false }),
      dim('featureFlag', 'Feature flag that served the request ("" = base).', 'string', { operators: EXACT_OPS }),
      dim('routerVersion', 'Router version.'),
      dim('clusterName', 'Router cluster name.'),
      dim('protocol', 'http, ws, sse or grpc (`wg.operation.protocol`).', 'string', { operators: EXACT_OPS }),
      dim('isBatched', 'The request was a batch.', 'boolean'),
      dim('serviceInstanceId', 'Router instance ID.'),
      dim('hostname', 'Router host name.'),
    ],
    measures: [
      measure('count', 'Number of sampled requests.', 'count'),
      measure('errors', 'Sampled requests that failed.', 'count'),
      measure('errorRate', 'errors ÷ count × 100.', 'percent'),
      ...SPAN_DURATION_MEASURES,
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['count', 'errorRate', 'durationP95'],
    timeBuckets: SAMPLED_BUCKETS,
    attributeDimensions: true,
    parameterizedMeasures: [],
    inventoryDimensions: [],
    caveats: [
      'Sampled: use for examples, ratios and exact tail latency, never for totals.',
      'A batched request is one row with an empty operation name; use the spans dataset to match its operations.',
    ],
  },
  {
    name: 'spans',
    description:
      'Every sampled span (router phases, subgraph fetches, instrumented subgraphs): where the time goes, fetch failures, any span attribute.',
    grain: 'span',
    completeness: 'sampled',
    retentionFeature: 'tracing-retention',
    storageTtlDays: 30,
    dimensions: [
      dim(
        'spanName',
        'Span name, e.g. `Operation - Plan`, `Engine - Fetch`, or `query GetOrder` for one operation of a batch.',
      ),
      dim('spanKind', 'SPAN_KIND_SERVER, SPAN_KIND_INTERNAL or SPAN_KIND_CLIENT.', 'string', { operators: EXACT_OPS }),
      dim('serviceName', 'Service that emitted the span (router, instrumented subgraph, gRPC plugin).'),
      dim('subgraphName', 'Subgraph of a fetch span.'),
      dim('subgraphId', 'Subgraph ID of a fetch span.', 'string', { operators: EXACT_OPS }),
      dim('statusCode', 'STATUS_CODE_UNSET, STATUS_CODE_OK or STATUS_CODE_ERROR.', 'string', { operators: EXACT_OPS }),
      dim('statusMessage', 'Span status message.'),
      dim('isRoot', 'The router root span of a request.', 'boolean'),
      dim('hasError', 'The span has an error status.', 'boolean'),
      dim('durationMs', 'Span duration (row filter).', 'number', { groupable: false }),
      ...OPERATION_DIMS,
      dim('featureFlag', 'Feature flag ("" = base).', 'string', { operators: EXACT_OPS }),
      dim('routerVersion', 'Router version.'),
      dim('clusterName', 'Router cluster name.'),
      dim('serviceInstanceId', 'Router instance ID.'),
      dim('hostname', 'Host name.'),
    ],
    measures: [
      measure('count', 'Number of sampled spans.', 'count'),
      measure('errors', 'Spans with an error status.', 'count'),
      measure('errorRate', 'errors ÷ count × 100.', 'percent'),
      measure('traces', 'Distinct traces.', 'count'),
      ...SPAN_DURATION_MEASURES,
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['count', 'durationAvg', 'durationP95'],
    timeBuckets: SAMPLED_BUCKETS,
    attributeDimensions: true,
    parameterizedMeasures: [],
    inventoryDimensions: [],
    caveats: [
      'Sampled.',
      'Operation and client attributes are set after parsing, so `HTTP - Read Body`, `Authenticate` and `Operation - Parse` spans carry none.',
      'Each retry of a subgraph fetch is its own client span under `Engine - Fetch`.',
    ],
  },
  {
    name: 'field_usage',
    description:
      'Schema usage (complete): every field, argument and input field each operation selected, in 5-minute buckets.',
    grain: '5m',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 90,
    dimensions: FIELD_USAGE_DIMS,
    measures: [
      measure('usages', 'Selections × requests (aliases add up); not a request count.', 'count'),
      measure('errorUsages', 'Usages in requests that failed.', 'count'),
      measure('clientErrorUsages', 'Usages in requests that failed with HTTP 4xx.', 'count'),
      measure('operations', 'Distinct operations.', 'count'),
      measure('clients', 'Distinct clients (name and version).', 'count'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['usages', 'operations', 'clients'],
    timeBuckets: METRIC_BUCKETS,
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: ['graph'],
    caveats: [
      'Enum values are not collected.',
      'Introspection is excluded unless you filter on isIntrospection.',
      'Arguments use path [field, argument]; inputs use [InputType] or [ParentInput, field].',
    ],
  },
  {
    name: 'schema_presence',
    description: 'Daily schema usage presence (complete): which fields, arguments and inputs were used on which days.',
    grain: '1d',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 90,
    dimensions: FIELD_USAGE_DIMS,
    measures: [
      measure('daysUsed', 'Days with at least one use.', 'days'),
      measure('operations', 'Distinct operations.', 'count'),
      measure('clients', 'Distinct clients (name and version).', 'count'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['daysUsed', 'lastSeen'],
    timeBuckets: ['1d', '7d'],
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: ['graph'],
    caveats: ['Presence only, no counts.', 'Enum values are not collected.'],
  },
  {
    name: 'router_runtime',
    description:
      'Router runtime metrics per instance (complete, raw ~15s samples): uptime, CPU, memory, goroutines, GC, plus each instance’s config version.',
    grain: 'raw',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 30,
    dimensions: [
      dim(
        'metricName',
        'e.g. `process.uptime`, `process.cpu.usage`, `server.uptime`, `process.runtime.go.mem.heap_alloc`.',
      ),
      dim('serviceInstanceId', 'Router instance ID.'),
      dim('hostname', 'Host name.'),
      dim('clusterName', 'Cluster name.'),
      dim('routerVersion', 'Router version.'),
      dim('serviceName', 'Router service name.'),
      dim('processId', 'Process ID (a new one means a restart).'),
      dim('configVersion', 'Router config version (schema version ID).', 'string', { operators: EXACT_OPS }),
      COMPOSITION,
      GRAPH,
    ],
    measures: [
      measure('avg', 'Average value.', 'value'),
      measure('min', 'Minimum value.', 'value'),
      measure('max', 'Maximum value.', 'value'),
      measure('last', 'Latest value.', 'value'),
      measure('samples', 'Number of samples.', 'count'),
      measure('processes', 'Distinct processes (restarts + 1 per instance).', 'count'),
      ...SEEN_MEASURES,
    ],
    defaultMeasures: ['last', 'lastSeen'],
    timeBuckets: SAMPLED_BUCKETS,
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: ['graph'],
    caveats: ['`firstSeen` per instance and config version shows when a composition reached each router.'],
  },
  {
    name: 'operation_documents',
    description:
      'Normalized operation documents with traffic inside your retention; filter on `content` to search them.',
    grain: 'operation',
    completeness: 'complete',
    retentionFeature: 'analytics-retention',
    storageTtlDays: 90,
    dimensions: [
      dim('operationHash', 'Operation hash.', 'string', { operators: EXACT_OPS }),
      dim('operationName', 'Operation name.'),
      dim('operationType', 'query, mutation or subscription.', 'string', { operators: EXACT_OPS }),
      dim('content', 'The normalized document (filter only).', 'string', {
        operators: ['contains', 'starts_with'],
        groupable: false,
      }),
      GRAPH,
    ],
    measures: [measure('document', 'The normalized document.', 'text')],
    defaultMeasures: ['document'],
    timeBuckets: [],
    attributeDimensions: false,
    parameterizedMeasures: [],
    inventoryDimensions: [],
    caveats: ['Documents are normalized: fragments are inlined and their names removed, literals become variables.'],
  },
];

export const findAnalyticsDataset = (name: string): AnalyticsDatasetDescriptor | undefined =>
  ANALYTICS_DATASETS.find((dataset) => dataset.name === name);

/** `attr:<key>` attribute dimensions: the key is passed as a query parameter but must still look like an attribute key. */
export const ANALYTICS_ATTRIBUTE_KEY_PATTERN = /^[\w.-]{1,128}$/;

export const ANALYTICS_ATTRIBUTE_PREFIX = 'attr:';
