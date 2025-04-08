import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { z } from 'zod';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListSubgraphsTool, registerSubgraphVerifySchemaChangesTool } from './tools/index.js';
import { registerFederatedGraphTools } from './tools/federated-graph-tools.js';
import { registerGetSubgraphsTool } from './tools/get-subgraphs.js';

export default (opts: BaseCommandOptions) => {
    const command = new Command('mcp');
    command.description('Start the MCP server');

    command.action(async () => {
        // Create an MCP server
        const server = new McpServer({
            name: "Demo",
            version: "1.0.0"
        });

        // Register all tools
        registerListSubgraphsTool({ server, opts });
        registerGetSubgraphsTool({ server, opts });
        registerSubgraphVerifySchemaChangesTool({ server, opts });
        registerFederatedGraphTools({ server, opts });

        server.tool(
            "schema-change-proposal",
            "Use this tool to generate a list of instructions to make a successful schema change for a Supergraph.",
            { change: z.string(), supergraph: z.string(), namespace: z.string().optional() },
            async ({ change, supergraph, namespace }) => ({
                content: [
                    {
                        type: "text",
                        text: `Load the schema of the ${supergraph} Supergraph ${namespace ? `in the namespace ${namespace}` : ""}.
                                Next, load all subgraphs of the ${supergraph} Supergraph.
                                Then analyze which Subgraphs could be best to make the proposed changed by the user:
                                ${change}
                                Finally, use the subgraph-verify-schema changes tool to verify the changes.
                                If the validation fails, try to use the error messages to propose a new schema change.
                                If the validation succeeds, return the list of subgraphs that should make the change.
                                Print out all diffs of the schema changes for each subgraph.
                                Additionally, print out the diff of the supergraph.`
                    }
                ]
            })
        );

        // Start receiving messages on stdin and sending messages on stdout
        const transport = new StdioServerTransport();
        await server.connect(transport);
    });

    return command;
};