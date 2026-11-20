import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import {
  filterInput,
  graphsInput,
  rowsToObjects,
  serverMeta,
  toGraphRefs,
  toPredicate,
  toTimeWindow,
} from '../query.js';
import { windowInput } from '../window.js';

/** Request counts, error rate and p95 latency for the metric datasets; the dataset's own defaults otherwise. */
const defaultMeasures = (dataset: string) =>
  dataset === 'operation_metrics' || dataset === 'subgraph_metrics' ? ['requests', 'errorRate', 'latencyP95'] : [];

export function registerComparePeriodsTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'compare_periods',
    {
      title: 'Compare periods',
      description:
        'Compares a window with the previous period of the same length (or a custom baseline): e.g. this week vs last week, before vs after a deploy, which operations regressed. Each measure comes back with <measure>Baseline, <measure>Delta and <measure>DeltaPct. Rows that only exist in the baseline (stopped traffic) are kept with 0. minVolume drops rows whose first measure is below it in both periods. Defaults: operation_metrics by operationName, requests, errorRate and latencyP95, sorted by the largest relative change of the first measure.',
      inputSchema: {
        ...graphsInput,
        ...windowInput,
        dataset: z
          .enum([
            'operation_metrics',
            'subgraph_metrics',
            'planning_metrics',
            'request_volume',
            'requests',
            'spans',
            'field_usage',
            'router_runtime',
          ])
          .default('operation_metrics'),
        dimensions: z.array(z.string()).default(['operationName']),
        measures: z.array(z.string()).default([]),
        filters: z.array(filterInput).default([]),
        baselineFrom: z.string().optional().describe('Custom baseline start (ISO 8601); default: the previous period.'),
        baselineTo: z.string().optional(),
        minVolume: z.number().nonnegative().optional(),
        orderBy: z
          .array(z.object({ field: z.string(), desc: z.boolean().default(true) }))
          .default([])
          .describe('e.g. [{field: "latencyP95DeltaPct", desc: true}] for the worst regressions.'),
        limit: z.number().int().positive().max(1000).default(20),
      },
    },
    async (input, headers) => {
      if (Boolean(input.baselineFrom) !== Boolean(input.baselineTo)) {
        return fail('baselineFrom and baselineTo must be given together.');
      }
      const measures = input.measures.length > 0 ? input.measures : defaultMeasures(input.dataset);
      const orderBy =
        input.orderBy.length > 0 || measures.length === 0
          ? input.orderBy
          : [{ field: `${measures[0]}DeltaPct`, desc: true }];
      const resp = await ctx.client.queryAnalytics(
        {
          ...toGraphRefs(input),
          dataset: input.dataset,
          dimensions: input.dimensions,
          measures,
          filters: input.filters.map((filter) => toPredicate(filter)),
          window: toTimeWindow(input),
          compare: {
            previousPeriod: !input.baselineFrom,
            baselineStart: input.baselineFrom,
            baselineEnd: input.baselineTo,
            minVolume: input.minVolume,
          },
          orderBy,
          limit: input.limit,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Comparison');
      if (error) {
        return fail(error);
      }
      return ok(
        { rows: rowsToObjects(resp.rows, resp.columns) },
        serverMeta(resp.meta, { now: ctx.now().toISOString() }),
      );
    },
  );
}
