import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { metricsFilters } from '../metrics-rpc.js';
import { metricsWindow, retainedWindow, windowInput } from '../window.js';

export function registerGetOperationTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_operation',
    {
      title: 'Get operation',
      description:
        'Everything about one operation: its normalized document, the clients and versions sending it, the deprecated fields it uses, and its request rate, p95 latency and error rate over a window. Identify it by hash (from list_operations); add the name to narrow it when several share a hash.',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        hash: z.string().describe('Operation hash.'),
        name: z.string().optional().describe('Operation name.'),
      },
    },
    async (input, headers) => {
      const { window, warnings: windowWarnings } = await retainedWindow(ctx, input, 'analytics');
      const graph = { federatedGraphName: input.graph, namespace: input.namespace };
      const [content, clients, deprecated, metrics] = await Promise.all([
        ctx.client.getOperationContent(
          { federatedGraphName: input.graph, namespace: input.namespace, hash: input.hash, name: input.name },
          { headers },
        ),
        ctx.client.getOperationClients(
          { ...graph, operationHash: input.hash, operationName: input.name ?? '', ...metricsWindow(window) },
          { headers },
        ),
        ctx.client.getOperationDeprecatedFields(
          { ...graph, operationHash: input.hash, operationName: input.name, ...metricsWindow(window) },
          { headers },
        ),
        ctx.client.getGraphMetrics(
          {
            ...graph,
            ...metricsWindow(window),
            filters: metricsFilters({ operationHash: input.hash, operationName: input.name }),
          },
          { headers },
        ),
      ]);
      const error =
        checkResponse(clients, 'Operation clients') ??
        checkResponse(deprecated, 'Deprecated fields') ??
        checkResponse(metrics, 'Operation metrics');
      if (error) {
        return fail(error);
      }
      // A document is only kept while the operation has traffic inside the plan's retention.
      const contentError = checkResponse(content, 'Operation document');

      return ok(
        {
          hash: input.hash,
          content: contentError ? undefined : content.operationContent,
          clients: clients.clients,
          deprecatedFields: deprecated.deprecatedFields,
          requests: metrics.requests,
          latency: metrics.latency,
          errors: metrics.errors,
        },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window,
          now: ctx.now().toISOString(),
          warnings: [
            ...windowWarnings,
            ...(contentError ? [`Document unavailable: ${content.response?.details ?? contentError}`] : []),
          ],
        },
      );
    },
  );
}
