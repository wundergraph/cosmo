import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { parseWindow, windowInput } from '../window.js';
import { metricsFilterInput, metricsFilters, metricsWindow } from './metrics-request.js';

export function registerGetSubgraphOverviewTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_subgraph_overview',
    {
      title: 'Get subgraph overview',
      description:
        'Fetch rate, p95 latency and error rate of one subgraph over a window, with the previous period, a time series and the top operations, plus the error-rate series. Counts fetches from routers to the subgraph (one client request can fetch a subgraph several times), across every graph the subgraph belongs to. Complete data.',
      inputSchema: {
        subgraph: z.string().describe('Name of the subgraph.'),
        namespace: z.string().default('default').describe('Namespace of the subgraph. Defaults to "default".'),
        ...windowInput,
        ...metricsFilterInput,
      },
    },
    async (input, headers) => {
      const window = parseWindow(input);
      const request = {
        subgraphName: input.subgraph,
        namespace: input.namespace,
        ...metricsWindow(window),
        filters: metricsFilters(input),
      };
      const [metrics, errorRate] = await Promise.all([
        ctx.client.getSubgraphMetrics(request, { headers }),
        ctx.client.getSubgraphMetricsErrorRate(request, { headers }),
      ]);
      const error = checkResponse(metrics, 'Subgraph metrics') ?? checkResponse(errorRate, 'Subgraph error rate');
      if (error) {
        return fail(error);
      }
      return ok(
        {
          requests: metrics.requests,
          latency: metrics.latency,
          errors: metrics.errors,
          errorRateSeries: errorRate.series,
        },
        {
          completeness: 'complete',
          window,
          granularity: metrics.resolution ? `${metrics.resolution}m` : undefined,
          now: ctx.now().toISOString(),
          warnings: ['Latency percentiles at or above 10s are reported as 10000ms (the histogram ends there).'],
        },
      );
    },
  );
}
