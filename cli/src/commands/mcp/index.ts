import { Command, Option } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BaseCommandOptions } from '../../core/types/types.js';
import { config } from '../../core/config.js';
import { readConfigFile, updateConfigFile } from '../../utils.js';
import { refreshAccessToken } from '../auth/utils.js';
import { type AuthMode, createAuthProvider } from './auth.js';
import { createReadOnlyAnalyticsClient } from './analytics/client.js';
import { ANALYTICS_INSTRUCTIONS, registerAnalyticsTools } from './analytics/server.js';
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
  command.addOption(
    new Option(
      '--auth <mode>',
      'How analytics tools authenticate: "user" (your `wgc auth login` session; namespace login-method restrictions apply) or "api-key" (COSMO_API_KEY). Defaults to api-key when COSMO_API_KEY is set, otherwise user.',
    ).choices(['user', 'api-key']),
  );

  command.option(
    '--toolsets <list>',
    'Comma-separated toolsets to register: "schema" (subgraphs, supergraphs, checks) and "analytics" (read-only analytics).',
    'schema,analytics',
  );

  command.action(async (options: { auth?: AuthMode; toolsets: string }) => {
    const toolsets = new Set(options.toolsets.split(',').map((toolset) => toolset.trim()));
    const auth = createAuthProvider({
      mode: options.auth,
      apiKey: process.env.COSMO_API_KEY,
      version: config.version,
      readConfig: readConfigFile,
      writeConfig: updateConfigFile,
      refresh: refreshAccessToken,
    });

    // Create an MCP server
    const server = new McpServer(
      {
        name: 'Cosmo MCP Server',
        version: '0.0.1',
      },
      toolsets.has('analytics') ? { instructions: ANALYTICS_INSTRUCTIONS } : undefined,
    );

    if (toolsets.has('analytics')) {
      let organizationSlug: Promise<string> | undefined;
      const client = createReadOnlyAnalyticsClient(opts.client.platform);
      registerAnalyticsTools({
        server,
        client,
        auth,
        webURL: config.webURL,
        now: () => new Date(),
        getOrgSlug: () => {
          organizationSlug ??= auth
            .getHeaders()
            .then((headers) => client.whoAmI({}, { headers }))
            .then((resp) => resp.organizationSlug)
            .catch((error) => {
              // Don't cache a failure (e.g. not logged in yet): retry on the next call.
              organizationSlug = undefined;
              throw error;
            });
          return organizationSlug;
        },
      });
    }

    if (toolsets.has('schema')) {
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
    }
    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });

  return command;
};
