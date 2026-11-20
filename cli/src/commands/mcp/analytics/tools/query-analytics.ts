import { ANALYTICS_DATASETS } from '@wundergraph/cosmo-shared';
import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { studioUrl } from '../links.js';
import {
  DATASET_NAMES,
  filterInput,
  graphsInput,
  OPERATORS,
  rowsToObjects,
  serverMeta,
  toGraphRefs,
  toPredicate,
} from '../query-rpc.js';
import { queryWindow, windowInput } from '../window.js';

/** One line per dataset, generated from the shared catalog the server compiles from. */
export const datasetCatalogText = () =>
  ANALYTICS_DATASETS.map(
    (d) =>
      `- ${d.name} (${d.completeness}, ${d.grain}): ${d.description} Dimensions: ${d.dimensions
        .filter((dim) => dim.groupable)
        .map((dim) => dim.name)
        .join(', ')}${d.attributeDimensions ? ', attr:<key>' : ''}. Measures: ${[
        ...d.measures.map((m) => m.name),
        ...d.parameterizedMeasures.map((p) => p.pattern),
      ].join(', ')}.`,
  ).join('\n');

export const queryInput = {
  ...graphsInput,
  ...windowInput,
  dataset: z.enum(DATASET_NAMES),
  dimensions: z.array(z.string()).default([]).describe('Group by these dimensions (up to 6).'),
  measures: z.array(z.string()).default([]).describe("Measures to compute; the dataset's defaults when empty."),
  filters: z.array(filterInput).default([]),
  having: z
    .array(
      z.object({
        measure: z.string(),
        operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
        value: z.number(),
      }),
    )
    .default([])
    .describe('Conditions on measures, e.g. requests >= 100.'),
  timeBucket: z.string().optional().describe('Group by time: one of the dataset buckets (e.g. 5m, 1h, 1d).'),
  orderBy: z.array(z.object({ field: z.string(), desc: z.boolean().default(true) })).default([]),
  limit: z.number().int().positive().max(1000).default(20),
  cursor: z.string().optional(),
  includeInactive: z
    .boolean()
    .default(false)
    .describe(
      'Add zero rows for graphs, subgraphs or feature flags with no traffic (one such dimension, no timeBucket).',
    ),
  explain: z.boolean().default(false).describe('Also return the tables read and the filters applied.'),
};

export function registerQueryAnalyticsTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'query_analytics',
    {
      title: 'Query analytics',
      description: [
        'Answers any analytics question one dataset can answer: group by dimensions, compute measures, filter, sort, bucket by time, across one graph, several (graphs) or all you can read (allGraphs).',
        'Complete datasets (metrics, schema usage, request volume) give counts; sampled ones (requests, spans) give examples, ratios and exact tail latency.',
        'Filter operators: eq, neq, in, not_in, gt, gte, lt, lte, contains, starts_with, exists (attr:<key> only).',
        'Use list_dimension_values to discover values and attribute keys. Read cosmo://analytics/datasets for every dimension and measure with its meaning.',
        'Datasets:',
        datasetCatalogText(),
      ].join('\n'),
      inputSchema: queryInput,
    },
    async (input, headers) => {
      const resp = await ctx.client.queryAnalytics(
        {
          ...toGraphRefs(input),
          dataset: input.dataset,
          dimensions: input.dimensions,
          measures: input.measures,
          filters: input.filters.map((filter) => toPredicate(filter)),
          having: input.having.map((h) => ({ measure: h.measure, operator: OPERATORS[h.operator], value: h.value })),
          timeBucket: input.timeBucket,
          window: queryWindow(input),
          orderBy: input.orderBy,
          limit: input.limit,
          cursor: input.cursor,
          includeInactive: input.includeInactive,
          explain: input.explain,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Query');
      if (error) {
        return fail(error);
      }
      return ok(
        { rows: rowsToObjects(resp.rows, resp.columns) },
        serverMeta(resp.meta, {
          now: ctx.now().toISOString(),
          studioUrl:
            input.graph && !input.allGraphs
              ? studioUrl(ctx.webURL, await ctx.getOrgSlug(), input.namespace, input.graph, 'analytics')
              : undefined,
        }),
      );
    },
  );
}
