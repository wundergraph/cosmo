import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';

export function registerListRoutersTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'list_routers',
    {
      title: 'List routers',
      description:
        'The router instances currently serving a graph: hostname, cluster, router version, instance and process ID, the composition they run and whether it is the latest, uptime, memory and CPU usage.',
      inputSchema: graphInput,
    },
    async (input, headers) => {
      const resp = await ctx.client.getRouters({ fedGraphName: input.graph, namespace: input.namespace }, { headers });
      const error = checkResponse(resp, 'Routers');
      if (error) {
        return fail(error);
      }
      return ok(
        { routers: resp.routers },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          now: ctx.now().toISOString(),
          warnings: [],
        },
      );
    },
  );
}
