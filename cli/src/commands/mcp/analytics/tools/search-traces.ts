import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { msToNs, nsToMs } from '../format.js';
import { studioUrl } from '../links.js';
import { filterInput, OPERATORS, serverMeta, toPredicate } from '../query-rpc.js';
import { queryWindow, windowInput } from '../window.js';

const MAX_PAGE = 100;
const REQUEST_FIELDS = [
  'operationName',
  'operationHash',
  'persistedOperationId',
  'clientName',
  'clientVersion',
  'httpStatusCode',
  'featureFlag',
  'routerVersion',
] as const;

const spanCondition = z.object({
  spanName: z
    .string()
    .optional()
    .describe('Span name, e.g. "Engine - Fetch" (a subgraph fetch), "Operation - Plan", "Operation - Execute".'),
  spanNamePrefix: z.boolean().default(false).describe('Match span names that start with spanName.'),
  subgraph: z.string().optional().describe('Subgraph name of a fetch span.'),
  minDurationMs: z.number().nonnegative().optional(),
  maxDurationMs: z.number().nonnegative().optional(),
  errorsOnly: z.boolean().optional().describe('Only spans with an error status.'),
  attributes: z.array(filterInput).default([]).describe('Further conditions: spans dataset fields or attr:<key>.'),
});

export function registerSearchTracesTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'search_traces',
    {
      title: 'Search traces',
      description: [
        'Find individual sampled requests (traces) of a graph.',
        'Request-level: operation, client, persisted ID, HTTP status, feature flag, router version, errors, duration, and any root-span attribute (attributes, e.g. {field: "attr:wg.operation.variables", operator: "contains", value: "user-42"}).',
        'Span-level: spanConditions, each matched by at least one span of the trace, e.g. traces where the fetch to subgraph "products" took over 50s: {spanName: "Engine - Fetch", subgraph: "products", minDurationMs: 50000}. Several conditions are ANDed.',
        'Operation filters also match operations inside batched requests.',
        'Traces are SAMPLED: use them as examples, never totals (query_analytics on operation_metrics has complete counts).',
        'Returns trace and root span IDs for get_trace; sort "slowest" orders by request duration, or by the slowest matching span with spanConditions.',
      ].join(' '),
      inputSchema: {
        ...graphInput,
        ...windowInput,
        operationName: z.string().optional(),
        operationHash: z.string().optional(),
        persistedOperationId: z.string().optional(),
        clientName: z.string().optional(),
        clientVersion: z.string().optional(),
        httpStatusCode: z.string().optional().describe('e.g. "500".'),
        featureFlag: z.string().optional().describe('Requests served by this feature flag.'),
        routerVersion: z.string().optional(),
        attributes: z
          .array(filterInput)
          .default([])
          .describe('Conditions on the request (root span): requests dataset fields or attr:<key>.'),
        errorsOnly: z.boolean().optional().describe('Only requests that failed.'),
        minDurationMs: z.number().nonnegative().optional().describe('Only requests that took at least this long.'),
        maxDurationMs: z.number().nonnegative().optional().describe('Only requests that took at most this long.'),
        spanConditions: z.array(spanCondition).max(5).default([]),
        sort: z.enum(['newest', 'slowest']).default('newest'),
        limit: z.number().int().positive().default(20).describe(`Traces to return (at most ${MAX_PAGE}).`),
        cursor: z.string().optional().describe('nextCursor from a previous page of the same search.'),
      },
    },
    async (input, headers) => {
      const requestFilters = [
        ...REQUEST_FIELDS.filter((field) => input[field] !== undefined).map((field) => ({
          field,
          operator: OPERATORS.eq,
          values: [String(input[field])],
        })),
        ...input.attributes.map((filter) => toPredicate(filter)),
      ];
      const resp = await ctx.client.searchTraces(
        {
          graph: { name: input.graph, namespace: input.namespace },
          window: queryWindow(input),
          requestFilters,
          spanConditions: input.spanConditions.map((condition) => ({
            spanName: condition.spanName,
            spanNamePrefix: condition.spanNamePrefix,
            subgraphName: condition.subgraph,
            minDurationNs: condition.minDurationMs === undefined ? undefined : msToNs(condition.minDurationMs),
            maxDurationNs: condition.maxDurationMs === undefined ? undefined : msToNs(condition.maxDurationMs),
            hasError: condition.errorsOnly,
            attributes: condition.attributes.map((filter) => toPredicate(filter)),
          })),
          minDurationNs: input.minDurationMs === undefined ? undefined : msToNs(input.minDurationMs),
          maxDurationNs: input.maxDurationMs === undefined ? undefined : msToNs(input.maxDurationMs),
          hasError: input.errorsOnly,
          sort: input.sort === 'slowest' ? 'duration' : 'timestamp',
          limit: Math.min(input.limit, MAX_PAGE),
          cursor: input.cursor,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Trace search');
      if (error) {
        return fail(error);
      }

      const traces = resp.traces.map((trace) => ({
        traceId: trace.traceId,
        spanId: trace.spanId,
        timestamp: trace.timestamp,
        durationMs: nsToMs(trace.durationNs),
        operationName: trace.operationName,
        operationType: trace.operationType,
        operationHash: trace.operationHash,
        persistedOperationId: trace.operationPersistedId,
        clientName: trace.clientName,
        clientVersion: trace.clientVersion,
        httpStatusCode: trace.httpStatusCode,
        hasError: trace.hasError,
        statusMessage: trace.statusMessage,
        ...(input.spanConditions.length > 0 && input.sort === 'slowest'
          ? { slowestMatchMs: nsToMs(trace.sortDurationNs) }
          : {}),
        matchedSpans: trace.matchedSpans.map((span) => ({
          spanId: span.spanId,
          spanName: span.spanName,
          subgraph: span.subgraphName,
          operationName: span.operationName,
          durationMs: nsToMs(span.durationNs),
          condition: span.condition,
        })),
      }));

      return ok(
        { traces },
        serverMeta(resp.meta, {
          now: ctx.now().toISOString(),
          warnings: ['Traces are sampled; counts here are not totals.'],
          studioUrl: studioUrl(ctx.webURL, await ctx.getOrgSlug(), input.namespace, input.graph, 'traces'),
        }),
      );
    },
  );
}
