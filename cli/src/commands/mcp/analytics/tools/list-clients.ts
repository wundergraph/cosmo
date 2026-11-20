import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { rowsToObjects, serverMeta, toTimeWindow } from '../query.js';
import { windowInput } from '../window.js';

export function registerListClientsTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'list_clients',
    {
      title: 'List clients',
      description:
        'Every client name and version that sent traffic in the window (complete metrics), with requests, errors, error rate and first/last seen, plus the clients registered with persisted operations: registered clients without traffic are listed as inactive. Use for client adoption, old versions still active, and unidentified traffic (client "unknown", version "missing").',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        limit: z.number().int().positive().max(1000).default(100),
      },
    },
    async (input, headers) => {
      const [traffic, registered] = await Promise.all([
        ctx.client.queryAnalytics(
          {
            graphs: [{ name: input.graph, namespace: input.namespace }],
            dataset: 'operation_metrics',
            dimensions: ['clientName', 'clientVersion'],
            measures: ['requests', 'errors', 'errorRate', 'firstSeen', 'lastSeen'],
            orderBy: [{ field: 'requests', desc: true }],
            window: toTimeWindow(input),
            limit: input.limit,
          },
          { headers },
        ),
        ctx.client.getClients(
          { fedGraphName: input.graph, namespace: input.namespace, includeTraffic: false },
          { headers },
        ),
      ]);
      const error = checkResponse(traffic, 'Client traffic');
      if (error) {
        return fail(error);
      }
      const clients = rowsToObjects(traffic.rows, traffic.columns);
      const active = new Set(clients.map((client) => client.clientName));
      const registeredClients = checkResponse(registered, 'Registered clients') ? [] : registered.clients;
      return ok(
        {
          clients,
          registeredWithoutTraffic: registeredClients
            .filter((client) => !active.has(client.name))
            .map((client) => ({
              clientName: client.name,
              registeredAt: client.createdAt,
              persistedOperations: client.persistedOperationsCount ?? null,
            })),
        },
        serverMeta(traffic.meta, { now: ctx.now().toISOString() }),
      );
    },
  );
}
