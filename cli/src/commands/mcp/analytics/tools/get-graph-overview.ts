import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { studioUrl } from '../links.js';
import { parseWindow, windowInput } from '../window.js';
import { metricsFilterInput, metricsFilters, metricsWindow, studioWindowParams } from './metrics-request.js';

export function registerGetGraphOverviewTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_graph_overview',
    {
      title: 'Get graph overview',
      description:
        'Request rate, p95 latency and error rate of a graph over a window, each with the previous period for comparison, a time series and the top operations; plus the error-rate series, the most requested operations and per-subgraph request rate, latency and error rate. Complete data (every request), not sampled. Optionally narrowed to one operation or client.',
      inputSchema: { ...graphInput, ...windowInput, ...metricsFilterInput },
    },
    async (input, headers) => {
      const window = parseWindow(input);
      const graph = { federatedGraphName: input.graph, namespace: input.namespace };
      const filters = metricsFilters(input);
      const [metrics, errorRate, dashboard] = await Promise.all([
        ctx.client.getGraphMetrics({ ...graph, ...metricsWindow(window), filters }, { headers }),
        ctx.client.getMetricsErrorRate({ ...graph, ...metricsWindow(window), filters }, { headers }),
        ctx.client.getDashboardAnalyticsView(
          {
            ...graph,
            range: window.range ?? 0,
            startDate: window.dateRange?.start ?? '',
            endDate: window.dateRange?.end ?? '',
          },
          { headers },
        ),
      ]);
      const error =
        checkResponse(metrics, 'Graph metrics') ??
        checkResponse(errorRate, 'Error rate') ??
        checkResponse(dashboard, 'Graph dashboard');
      if (error) {
        return fail(error);
      }

      return ok(
        {
          requests: metrics.requests,
          latency: metrics.latency,
          errors: metrics.errors,
          errorRateSeries: errorRate.series,
          mostRequestedOperations: dashboard.mostRequestedOperations,
          subgraphs: dashboard.subgraphMetrics,
        },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window,
          granularity: metrics.resolution ? `${metrics.resolution}m` : undefined,
          now: ctx.now().toISOString(),
          warnings: ['Latency percentiles at or above 10s are reported as 10000ms (the histogram ends there).'],
          studioUrl: studioUrl(
            ctx.webURL,
            await ctx.getOrgSlug(),
            input.namespace,
            input.graph,
            'analytics',
            studioWindowParams(window),
          ),
        },
      );
    },
  );
}
