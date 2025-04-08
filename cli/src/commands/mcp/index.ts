import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getBaseHeaders } from '../../core/config.js';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export default (opts: BaseCommandOptions) => {
    const command = new Command('mcp');
    command.description('Start the MCP server');

    command.action(async () => {

        // Create an MCP server
        const server = new McpServer({
            name: "Demo",
            version: "1.0.0"
        });

        // Add an addition tool
        server.tool("list-subgraphs",
            "List all subgraphs",
            {},
            async () => {
                const resp = await opts.client.platform.getSubgraphs(
                    {
                        limit: 0,
                        offset: 0,
                    },
                    {
                        headers: getBaseHeaders(),
                    },
                );

                if (resp.response?.code !== EnumStatusCode.OK) {
                    throw new Error(`Could not fetch subgraphs: ${resp.response?.details || ''}`);
                }

                const out = resp.graphs.map(graph => {
                    return {
                        id: graph.id,
                        name: graph.name,
                        labels: graph.labels,
                        routingURL: graph.routingURL,
                        lastUpdate: graph.lastUpdatedAt,
                    }
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(out, null, 2) }]
                }
            }
        );

        // Add a tool to get a single subgraph
        server.tool("get-subgraph",
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

        // Add a tool to check subgraph changes
        server.tool("subgraph-check",
            "Check if a subgraph schema change would be valid",
            {
                name: z.string().describe("The name of the subgraph"),
                namespace: z.string().optional().describe("The namespace of the subgraph"),
                schema: z.string().optional().describe("The new schema SDL to check"),
                delete: z.boolean().optional().describe("Run checks in case the subgraph should be deleted"),
                skipTrafficCheck: z.boolean().optional().describe("Skip checking for client traffic")
            },
            async (params) => {
                const schema = params.schema ? Buffer.from(params.schema) : Buffer.from('');

                const resp = await opts.client.platform.checkSubgraphSchema(
                    {
                        subgraphName: params.name,
                        namespace: params.namespace,
                        schema: new Uint8Array(schema),
                        delete: params.delete,
                        skipTrafficCheck: params.skipTrafficCheck,
                    },
                    {
                        headers: getBaseHeaders(),
                    },
                );

                // Format the check results in a readable way
                const formatResults = () => {
                    const results: string[] = [];

                    if (resp.compositionErrors?.length) {
                        results.push("Composition Errors:");
                        resp.compositionErrors.forEach(error => {
                            results.push(`- ${error.message}`);
                        });
                    }

                    if (resp.breakingChanges?.length) {
                        results.push("\nBreaking Changes:");
                        resp.breakingChanges.forEach((change: SchemaChange) => {
                            results.push(`- ${change.message} (${change.changeType})`);
                        });
                    }

                    if (resp.nonBreakingChanges?.length) {
                        results.push("\nNon-Breaking Changes:");
                        resp.nonBreakingChanges.forEach((change: SchemaChange) => {
                            results.push(`- ${change.message} (${change.changeType})`);
                        });
                    }

                    if (resp.compositionWarnings?.length) {
                        results.push("\nComposition Warnings:");
                        resp.compositionWarnings.forEach(warning => {
                            results.push(`- ${warning.message}`);
                        });
                    }

                    if (results.length === 0) {
                        results.push("No issues found - schema is valid!");
                    }

                    return results.join("\n");
                };

                return {
                    content: [{ type: "text", text: formatResults() }]
                };
            }
        );

        // Start receiving messages on stdin and sending messages on stdout
        const transport = new StdioServerTransport();
        await server.connect(transport);
    });

    return command;
}; 