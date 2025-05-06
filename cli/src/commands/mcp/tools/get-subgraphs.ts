import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { z } from 'zod';
import { Subgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { ToolContext } from './types.js';

export const registerGetSubgraphsTool = ({ server, opts }: ToolContext) => {
  server.tool(
    'get_subgraphs',
    'Get details for one or more subgraphs, including the SDL/GraphQL Schema for each.',
    {
      names: z.array(z.string()).describe('The names of the subgraphs'),
      namespace: z.string().optional().describe('The namespace of the subgraphs'),
    },
    async (params) => {
      const results: Array<Partial<Subgraph> & { sdl?: string }> = [];
      const errors: string[] = [];

      // Fetch details for all subgraphs first to potentially leverage batching if the API supports it later.
      // Currently, it iterates and fetches one by one.
      const subgraphDetailsPromises = params.names.map((name) =>
        opts.client.platform
          .getSubgraphs(
            {
              query: name,
              namespace: params.namespace,
              limit: 1,
              offset: 0,
            },
            {
              headers: getBaseHeaders(),
            },
          )
          .then((resp) => ({ name, resp })),
      );

      const subgraphDetailsResponses = await Promise.allSettled(subgraphDetailsPromises);

      const foundSubgraphs: { [name: string]: Subgraph } = {};

      for (const result of subgraphDetailsResponses) {
        if (result.status === 'rejected') {
          // Handle potential network or client errors
          errors.push(`Failed to initiate fetch for a subgraph: ${result.reason}`);
          continue;
        }

        const { name, resp } = result.value;

        if (resp.response?.code !== EnumStatusCode.OK) {
          errors.push(`Could not fetch subgraph '${name}': ${resp.response?.details || 'Unknown error'}`);
          continue;
        }

        if (resp.graphs.length === 0) {
          errors.push(
            `No subgraph found with name '${name}'${params.namespace ? ` in namespace '${params.namespace}'` : ''}.`,
          );
          continue;
        }

        foundSubgraphs[name] = resp.graphs[0];
      }

      // Fetch SDLs for the found subgraphs
      const sdlPromises = Object.entries(foundSubgraphs).map(
        ([name, graph]) =>
          opts.client.platform
            .getLatestSubgraphSDL(
              {
                name,
                namespace: params.namespace, // Use the common namespace
              },
              {
                headers: getBaseHeaders(),
              },
            )
            .then((sdlResp) => ({ name, sdlResp, graph })), // Pass graph info along
      );

      const sdlResponses = await Promise.allSettled(sdlPromises);

      for (const result of sdlResponses) {
        if (result.status === 'rejected') {
          // Find the original name associated with this failed promise if possible
          // This is tricky as the error might not contain the name directly.
          // We might need a different approach if precise error mapping per subgraph is critical here.
          errors.push(`Failed to fetch SDL for a subgraph: ${result.reason}`);
          continue; // Skip adding this subgraph to results
        }

        const { name, sdlResp, graph } = result.value;

        const out = {
          id: graph.id,
          name: graph.name,
          labels: graph.labels,
          routingURL: graph.routingURL,
          lastUpdate: graph.lastUpdatedAt,
          sdl: sdlResp.response?.code === EnumStatusCode.OK ? sdlResp.sdl : undefined,
        };
        results.push(out);

        if (sdlResp.response?.code !== EnumStatusCode.OK) {
          errors.push(`Could not fetch SDL for subgraph '${name}': ${sdlResp.response?.details || 'Unknown error'}`);
          // Keep the subgraph in results, but SDL will be undefined
        }
      }

      // Construct the final output message
      let outputText = '';
      if (results.length > 0) {
        outputText += `Found details for ${results.length} subgraph(s):\n${JSON.stringify(results, null, 2)}`;
      }
      if (errors.length > 0) {
        if (outputText.length > 0) {
          outputText += '\n\n'; // Add separation if there were results
        }
        outputText += `Encountered errors:\n- ${errors.join('\n- ')}`;
      }
      if (results.length === 0 && errors.length === 0) {
        outputText = 'No subgraphs found matching the provided names or an unexpected error occurred.';
      }

      // Ensure the return type matches the expected ToolOutput structure
      return {
        content: [{ type: 'text', text: outputText }],
      };
    },
  );
};
