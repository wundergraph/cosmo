import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { z } from 'zod';
import { getBaseHeaders } from '../../../core/config.js';
import {
  fetchRouterConfig,
  getFederatedGraphSchemas,
  getSubgraphSDL,
  getSubgraphsOfFedGraph,
} from '../../graph/federated-graph/utils.js';
import { ToolContext } from './types.js';

export const registerFederatedGraphTools = ({ server, opts }: ToolContext) => {
  // List federated graphs tool
  server.tool(
    'list_supergraphs',
    'List all federated graphs / Supergraphs',
    {
      namespace: z.string().optional().describe('Filter to get graphs in this namespace only'),
    },
    async ({ namespace }) => {
      try {
        const resp = await opts.client.platform.getFederatedGraphs(
          {
            includeMetrics: false,
            limit: 0,
            offset: 0,
            namespace,
            supportsFederation: true,
          },
          {
            headers: getBaseHeaders(),
          },
        );

        if (resp.response?.code !== EnumStatusCode.OK) {
          throw new Error(`Could not fetch federated graphs: ${resp.response?.details || ''}`);
        }

        const out = resp.graphs.map((graph) => ({
          name: graph.name,
          namespace: graph.namespace,
          labelMatchers: graph.labelMatchers,
          routingURL: graph.routingURL,
          isComposable: graph.isComposable,
          lastUpdatedAt: graph.lastUpdatedAt,
          isContract: !!graph.contract,
          contract: graph.contract
            ? {
                sourceFederatedGraphId: graph.contract.sourceFederatedGraphId,
                excludeTags: graph.contract.excludeTags,
                includeTags: graph.contract.includeTags,
              }
            : undefined,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        };
      } catch (e: any) {
        throw new Error(`Failed to list federated graphs: ${e.message}`);
      }
    },
  );

  // Fetch federated graph details tool
  server.tool(
    'fetch_supergraph',
    'Fetch the schemas and configuration of a federated graph / Supergraph',
    {
      name: z.string().describe('The name of the federated graph to fetch'),
      namespace: z.string().optional().describe('The namespace of the federated graph'),
    },
    async ({ name, namespace }) => {
      try {
        const fedGraphSchemas = await getFederatedGraphSchemas({
          client: opts.client,
          name,
          namespace,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name,
                  namespace,
                  schemas: {
                    sdl: fedGraphSchemas.sdl,
                    clientSchema: fedGraphSchemas.clientSchema,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e: any) {
        throw new Error(`Failed to fetch federated graph details: ${e.message}`);
      }
    },
  );

  // Fetch router config tool
  server.tool(
    'fetch_supergraph_router_config',
    'Fetch the router configuration for a federated graph / Supergraph',
    {
      name: z.string().describe('The name of the federated graph to fetch'),
      namespace: z.string().optional().describe('The namespace of the federated graph'),
    },
    async ({ name, namespace }) => {
      try {
        const routerConfig = await fetchRouterConfig({
          client: opts.client,
          name,
          namespace,
        });

        return {
          content: [{ type: 'text', text: routerConfig }],
        };
      } catch (e: any) {
        throw new Error(`Failed to fetch router config: ${e.message}`);
      }
    },
  );

  // Fetch subgraphs tool
  server.tool(
    'fetch_supergraph_subgraphs',
    'Fetch all subgraphs and their schemas for a federated graph / Supergraph',
    {
      name: z.string().describe('The name of the federated graph to fetch'),
      namespace: z.string().optional().describe('The namespace of the federated graph'),
    },
    async ({ name, namespace }) => {
      try {
        const subgraphs = await getSubgraphsOfFedGraph({
          client: opts.client,
          name,
          namespace,
        });

        const subgraphSchemas = subgraphs.map((subgraph) => ({
          name: subgraph.name,
          routingURL: subgraph.routingURL,
          isEventDriven: subgraph.isEventDrivenGraph,
          subscriptionURL: subgraph.subscriptionURL,
          subscriptionProtocol: subgraph.subscriptionProtocol,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(subgraphSchemas, null, 2) }],
        };
      } catch (e: any) {
        throw new Error(`Failed to fetch subgraphs: ${e.message}`);
      }
    },
  );
};
