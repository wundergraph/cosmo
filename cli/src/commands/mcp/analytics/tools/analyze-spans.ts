import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { filterInput, OPERATORS, rowsToObjects, serverMeta, toPredicate } from '../query-rpc.js';
import { queryWindow, windowInput } from '../window.js';

/** An equality filter on `field`, or none when the tool input left it out. */
const eq = (field: string, value: string | undefined) =>
  value === undefined ? [] : [{ field, operator: OPERATORS.eq, values: [value] }];

export function registerAnalyzeSpansTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'analyze_spans',
    {
      title: 'Analyze spans',
      description:
        'Where the time goes, from sampled spans: by default each span name (router phases like "Operation - Plan", subgraph fetches "Engine - Fetch", instrumented subgraph spans) with count, average, p95, total time, errors and an example trace. Narrow to an operation, client or subgraph; group by subgraphName, serviceName, attr:<key> (e.g. attr:wg.engine.plan_cache_hit for cache hit rates, attr:http.status_code on fetches) or anything in the spans dataset.',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        operationName: z.string().optional(),
        clientName: z.string().optional(),
        subgraph: z.string().optional().describe('Only spans of fetches to this subgraph.'),
        spanName: z.string().optional(),
        groupBy: z.array(z.string()).default(['spanName']),
        measures: z
          .array(z.string())
          .default(['count', 'durationAvg', 'durationP95', 'durationSum', 'errors', 'exampleTraceId']),
        filters: z.array(filterInput).default([]),
        limit: z.number().int().positive().max(1000).default(30),
      },
    },
    async (input, headers) => {
      const resp = await ctx.client.queryAnalytics(
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          dataset: 'spans',
          dimensions: input.groupBy,
          measures: input.measures,
          filters: [
            ...eq('operationName', input.operationName),
            ...eq('clientName', input.clientName),
            ...eq('subgraphName', input.subgraph),
            ...eq('spanName', input.spanName),
            ...input.filters.map((filter) => toPredicate(filter)),
          ],
          window: queryWindow(input),
          orderBy: input.measures.includes('durationSum') ? [{ field: 'durationSum', desc: true }] : [],
          limit: input.limit,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Span analysis');
      if (error) {
        return fail(error);
      }
      return ok(
        { rows: rowsToObjects(resp.rows, resp.columns) },
        serverMeta(resp.meta, {
          now: ctx.now().toISOString(),
          warnings: ['Spans are sampled: use these for where time goes and ratios, not totals.'],
        }),
      );
    },
  );
}
