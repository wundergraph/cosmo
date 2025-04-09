import { Command } from 'commander';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseCommandOptions } from '../../core/types/types.js';
import {
    registerListSubgraphsTool,
    registerSubgraphVerifySchemaChangesTool,
    registerFederatedGraphTools,
    registerGetSubgraphsTool,
    registerSchemaChangeProposalWorkflowTool,
    registerDreamQueryWorkflowTool,
    registerVerifyQueryAgainstRemoteSchemaTool,
    registerVerifyQueryAgainstInMemorySchemaTool,
} from './tools/index.js';

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
        registerSchemaChangeProposalWorkflowTool({ server, opts });
        registerDreamQueryWorkflowTool({ server, opts });
        registerVerifyQueryAgainstRemoteSchemaTool({ server, opts });
        registerVerifyQueryAgainstInMemorySchemaTool({ server, opts });

        // Start receiving messages on stdin and sending messages on stdout
        const transport = new StdioServerTransport();
        await server.connect(transport);
    });

    return command;
};