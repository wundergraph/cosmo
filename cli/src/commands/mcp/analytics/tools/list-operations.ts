import { OperationsFetchBasedOn, SortDirection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { studioUrl } from '../links.js';
import { parseWindow, windowInput } from '../window.js';
import { metricsWindow } from './metrics-request.js';

const SORT_BY = {
  requests: OperationsFetchBasedOn.REQUESTS,
  latency: OperationsFetchBasedOn.LATENCY,
  errors: OperationsFetchBasedOn.ERRORS,
} as const;

export function registerListOperationsTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'list_operations',
    {
      title: 'List operations',
      description:
        'Operations of a graph ranked by request count, p95 latency or error rate over a window, with whether each uses deprecated fields. Complete data. Each row carries the metric it was ranked by. Search by name or hash, filter by client, or keep only operations that use deprecated fields.',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        sortBy: z.enum(['requests', 'latency', 'errors']).default('requests').describe('Metric to rank by.'),
        direction: z.enum(['desc', 'asc']).default('desc').describe('"desc" for the highest first.'),
        search: z.string().optional().describe('Part of an operation name or hash.'),
        clientNames: z.array(z.string()).optional().describe('Only operations sent by these clients.'),
        deprecatedOnly: z.boolean().optional().describe('Only operations that use deprecated fields.'),
        limit: z.number().int().positive().default(20).describe('Rows to return (at most 1000).'),
        offset: z.number().int().nonnegative().default(0),
      },
    },
    async (input, headers) => {
      const window = parseWindow(input);
      const resp = await ctx.client.getOperations(
        {
          federatedGraphName: input.graph,
          namespace: input.namespace,
          ...metricsWindow(window),
          fetchBasedOn: SORT_BY[input.sortBy],
          sortDirection: input.direction === 'asc' ? SortDirection.ASC : SortDirection.DESC,
          searchQuery: input.search,
          clientNames: input.clientNames ?? [],
          includeOperationsWithDeprecatedFieldsOnly: input.deprecatedOnly,
          includeHasDeprecatedFields: true,
          includeTotalCount: true,
          limit: Math.min(input.limit, 1000),
          offset: input.offset,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Operations');
      if (error) {
        return fail(error);
      }
      return ok(
        { operations: resp.operations, totalCount: resp.totalCount },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window,
          now: ctx.now().toISOString(),
          truncated: resp.totalCount !== undefined && input.offset + resp.operations.length < resp.totalCount,
          warnings: ['p95 latency at or above 10s is reported as 10000ms (the histogram ends there).'],
          studioUrl: studioUrl(ctx.webURL, await ctx.getOrgSlug(), input.namespace, input.graph, 'operations'),
        },
      );
    },
  );
}
