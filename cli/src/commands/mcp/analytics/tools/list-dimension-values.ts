import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { DATASET_NAMES, filterInput, graphsInput, serverMeta, toGraphRefs, toPredicate } from '../query-rpc.js';
import { queryWindow, windowInput } from '../window.js';

export function registerListDimensionValuesTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'list_dimension_values',
    {
      title: 'List dimension values',
      description:
        'The values of one dimension with how often each occurs: discover client names, operation names, span names, subgraphs, feature flags or router versions before filtering on them. dimension "attributeKeys" (requests and spans datasets) lists every span attribute key stored, e.g. custom header attributes, for use as attr:<key>.',
      inputSchema: {
        ...graphsInput,
        ...windowInput,
        dataset: z.enum(DATASET_NAMES),
        dimension: z.string().describe('A dimension of the dataset, or "attributeKeys".'),
        prefix: z.string().optional().describe('Only values that start with this.'),
        filters: z.array(filterInput).default([]),
        limit: z.number().int().positive().max(1000).default(50),
      },
    },
    async (input, headers) => {
      const resp = await ctx.client.getAnalyticsDimensionValues(
        {
          ...toGraphRefs(input),
          dataset: input.dataset,
          dimension: input.dimension,
          prefix: input.prefix,
          filters: input.filters.map((filter) => toPredicate(filter)),
          window: queryWindow(input),
          limit: input.limit,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Dimension values');
      if (error) {
        return fail(error);
      }
      return ok(
        { values: resp.values.map((v) => ({ value: v.value, count: Number(v.count) })) },
        serverMeta(resp.meta, { now: ctx.now().toISOString() }),
      );
    },
  );
}
