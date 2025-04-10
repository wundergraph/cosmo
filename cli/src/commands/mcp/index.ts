import { Command } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
  registerIntrospectSubgraphTool,
  registerSupergraphChangelogTool,
  registerSearchDocsTool,
  registerVerifyRouterConfigTool,
} from './tools/index.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('mcp');
  command.description('Start the Cosmo MCP server');

  command.action(async () => {
    // Create an MCP server
    const server = new McpServer({
      name: 'Cosmo MCP Server',
      version: '0.0.1',
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
    registerIntrospectSubgraphTool({ server, opts });
    registerSupergraphChangelogTool({ server, opts });
    registerSearchDocsTool({ server, opts });
    registerVerifyRouterConfigTool({ server, opts });
    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });

  return command;
};
