import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { z } from 'zod';
import { ToolContext } from './types.js';

export const registerGetSubgraphTool = ({ server, opts }: ToolContext) => {
    server.tool(
        "get-subgraph",
        "Get details for a single subgraph, including the SDL/GraphQL Schema",
        {
            name: z.string().describe("The name of the subgraph"),
            namespace: z.string().optional().describe("The namespace of the subgraph")
        },
        async (params) => {
            const resp = await opts.client.platform.getSubgraphs(
                {
                    query: params.name,
                    namespace: params.namespace,
                    limit: 1,
                    offset: 0,
                },
                {
                    headers: getBaseHeaders(),
                },
            );

            if (resp.response?.code !== EnumStatusCode.OK) {
                throw new Error(`Could not fetch subgraph: ${resp.response?.details || ''}`);
            }

            if (resp.graphs.length === 0) {
                throw new Error(`No subgraph found with name ${params.name}`);
            }

            const getSDL = await opts.client.platform.getLatestSubgraphSDL(
                {
                    name: params.name,
                    namespace: params.namespace,
                },
                {
                    headers: getBaseHeaders(),
                },
            );

            const graph = resp.graphs[0];
            const out = {
                id: graph.id,
                name: graph.name,
                labels: graph.labels,
                routingURL: graph.routingURL,
                lastUpdate: graph.lastUpdatedAt,
                sdl: getSDL.response?.code === EnumStatusCode.OK ? getSDL.sdl : undefined,
            };

            return {
                content: [{ type: "text", text: JSON.stringify(out, null, 2) }]
            }
        }
    );
}; 