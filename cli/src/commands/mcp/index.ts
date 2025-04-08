import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListSubgraphsTool, registerGetSubgraphTool, registerSubgraphCheckTool } from './tools/index.js';

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
        registerGetSubgraphTool({ server, opts });
        registerSubgraphCheckTool({ server, opts });

        // Start receiving messages on stdin and sending messages on stdout
        const transport = new StdioServerTransport();
        await server.connect(transport);
    });

    return command;
}; 