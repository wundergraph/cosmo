import { Command, InvalidArgumentError, Option } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BaseCommandOptions } from '../../core/types/types.js';
import { config } from '../../core/config.js';
import { readConfigFile, updateConfigFile } from '../../utils.js';
import { refreshAccessToken } from '../auth/utils.js';
import { type AuthMode, createAuthProvider } from './auth.js';
import { createAnalyticsToolContext } from './analytics/context.js';
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

const TOOLSETS = ['schema', 'analytics'] as const;
type Toolset = (typeof TOOLSETS)[number];

/** The --toolsets value: a comma-separated list of known toolsets. */
export function parseToolsets(value: string): Set<Toolset> {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.length === 0 || names.some((name) => !(TOOLSETS as readonly string[]).includes(name))) {
    throw new InvalidArgumentError(`Use a comma-separated list of: ${TOOLSETS.join(', ')}.`);
  }
  return new Set(names as Toolset[]);
}

export default (opts: BaseCommandOptions) => {
  const command = new Command('mcp');
  command.description('Start the Cosmo MCP server');
  command.addOption(
    new Option(
      '--auth <mode>',
      'How analytics tools authenticate: "user" (your `wgc auth login` session; namespace login-method restrictions apply) or "api-key" (COSMO_API_KEY). Defaults to api-key when COSMO_API_KEY is set, otherwise user.',
    ).choices(['user', 'api-key']),
  );

  command.addOption(
    new Option(
      '--toolsets <list>',
      'Comma-separated toolsets to register: "schema" (subgraphs, supergraphs, checks) and "analytics" (read-only analytics).',
    )
      .default(new Set(TOOLSETS), TOOLSETS.join(','))
      .argParser(parseToolsets),
  );

  command.action(async ({ auth: authMode, toolsets }: { auth?: AuthMode; toolsets: Set<Toolset> }) => {
    const auth = createAuthProvider({
      mode: authMode,
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
      registerAnalyticsTools(
        createAnalyticsToolContext({ server, platform: opts.client.platform, auth, webURL: config.webURL }),
      );
    }

    if (toolsets.has('schema')) {
      registerListSubgraphsTool({ server, opts, auth });
      registerGetSubgraphsTool({ server, opts, auth });
      registerSubgraphVerifySchemaChangesTool({ server, opts, auth });
      registerFederatedGraphTools({ server, opts, auth });
      registerSchemaChangeProposalWorkflowTool({ server, opts });
      registerDreamQueryWorkflowTool({ server, opts });
      registerVerifyQueryAgainstRemoteSchemaTool({ server, opts, auth });
      registerVerifyQueryAgainstInMemorySchemaTool({ server, opts });
      registerIntrospectSubgraphTool({ server, opts });
      registerSupergraphChangelogTool({ server, opts, auth });
      registerSearchDocsTool({ server, opts, auth });
      registerVerifyRouterConfigTool({ server, opts, auth });
    }
    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });

  return command;
};
