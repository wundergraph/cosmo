import { createClient, createRouterTransport } from '@connectrpc/connect';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { describe, expect, test } from 'vitest';
import type { AuthProvider } from '../../src/commands/mcp/auth.js';
import { registerFederatedGraphTools } from '../../src/commands/mcp/tools/federated-graph-tools.js';
import { registerListSubgraphsTool } from '../../src/commands/mcp/tools/list-subgraphs.js';
import type { ToolContext } from '../../src/commands/mcp/tools/types.js';

/** Schema tools on a platform client that records the authorization header of every request. */
function schemaToolContext() {
  const authorizations: (string | null)[] = [];
  const platform = createClient(
    PlatformService,
    createRouterTransport(({ service }) =>
      service(PlatformService, {
        getSubgraphs: (_req, ctx) => {
          authorizations.push(ctx.requestHeader.get('authorization'));
          return { response: { code: EnumStatusCode.OK }, graphs: [], count: 0 };
        },
        getFederatedGraphSDLByName: (_req, ctx) => {
          authorizations.push(ctx.requestHeader.get('authorization'));
          return { response: { code: EnumStatusCode.OK }, sdl: 'type Query { a: String }' };
        },
      }),
    ),
  );
  const tools = new Map<string, (input: object) => Promise<unknown>>();
  const server = {
    registerTool: (name: string, _config: object, handler: (input: object) => Promise<unknown>) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const auth: AuthProvider = {
    mode: 'user',
    getHeaders: () => Promise.resolve({ authorization: 'Bearer user-token', 'x-cosmo-client': 'wgc-mcp/test' }),
  };
  const ctx = { server, opts: { client: { platform } }, auth } as unknown as ToolContext;
  return { ctx, tools, authorizations };
}

describe('Schema tools', () => {
  test('authenticate with the MCP auth provider, as the analytics tools do', async () => {
    const { ctx, tools, authorizations } = schemaToolContext();
    registerListSubgraphsTool(ctx);
    registerFederatedGraphTools(ctx);

    await tools.get('list_subgraphs')!({});
    await tools.get('fetch_supergraph')!({ name: 'shop', namespace: 'default' });

    expect(authorizations).toEqual(['Bearer user-token', 'Bearer user-token']);
  });
});
