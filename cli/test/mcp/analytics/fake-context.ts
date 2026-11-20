import { create } from '@bufbuild/protobuf';
import { createClient, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  GetAnalyticsCapabilitiesResponseSchema,
  PlatformService,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createReadOnlyAnalyticsClient } from '../../../src/commands/mcp/analytics/client.js';
import type { AnalyticsToolContext } from '../../../src/commands/mcp/analytics/context.js';

export type RegisteredTool = {
  config: { title: string; description: string; inputSchema: object; annotations: object };
  handler: (input: any) => Promise<CallToolResult>;
};

/**
 * An analytics tool context whose platform client is served by `impl`, and whose server records registered tools.
 */
export function fakeContext(
  impl: Partial<ServiceImpl<typeof PlatformService>>,
  now = new Date('2026-10-31T12:00:00Z'),
) {
  const tools = new Map<string, RegisteredTool>();
  const resources = new Map<string, (uri: URL) => Promise<{ contents: { text: string }[] }>>();
  const prompts = new Map<string, (args: Record<string, string>) => { messages: { content: { text: string } }[] }>();
  const server = {
    // Like the MCP SDK, validate the input with the tool's schema (applying defaults) before calling the handler.
    registerTool: (name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      const schema = z.object(config.inputSchema as z.ZodRawShape);
      tools.set(name, { config, handler: (input: unknown) => handler(schema.parse(input)) });
    },
    registerResource: (_name: string, uri: string, _config: object, read: (uri: URL) => Promise<any>) => {
      resources.set(uri, read);
    },
    registerPrompt: (name: string, _config: object, build: (args: Record<string, string>) => any) => {
      prompts.set(name, build);
    },
  } as unknown as McpServer;
  const platform = createClient(
    PlatformService,
    createRouterTransport(({ service }) => service(PlatformService, impl)),
  );
  const ctx: AnalyticsToolContext = {
    server,
    client: createReadOnlyAnalyticsClient(platform),
    auth: {
      mode: 'user',
      getHeaders: () => Promise.resolve({ authorization: 'Bearer test', 'x-cosmo-client': 'wgc-mcp/test' }),
    },
    webURL: 'https://cosmo.wundergraph.com',
    getOrgSlug: () => Promise.resolve('acme'),
    // The fake platform's capabilities when it serves them; otherwise a plan that retains everything a test asks for.
    getCapabilities: () =>
      impl.getAnalyticsCapabilities
        ? platform.getAnalyticsCapabilities({})
        : Promise.resolve(
            create(GetAnalyticsCapabilitiesResponseSchema, {
              retention: ['analytics', 'schema_usage', 'tracing', 'request_volume'].map((family) => ({
                family,
                effectiveDays: 90,
              })),
            }),
          ),
    now: () => now,
  };
  return { ctx, tools, resources, prompts };
}
