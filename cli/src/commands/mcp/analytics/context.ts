import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GetAnalyticsCapabilitiesResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z, type ZodRawShape } from 'zod';
import type { AuthProvider } from '../auth.js';
import type { Client } from '../../../core/client/client.js';
import { createReadOnlyAnalyticsClient, type ReadOnlyAnalyticsClient } from './client.js';
import { checkResponse, fail } from './envelope.js';

/** The parsed input of a tool whose input schema is `Shape`. */
export type ToolInput<Shape extends ZodRawShape> = z.output<z.ZodObject<Shape>>;

export type AnalyticsToolContext = {
  server: McpServer;
  client: ReadOnlyAnalyticsClient;
  auth: AuthProvider;
  webURL: string;
  getOrgSlug(): Promise<string>;
  /**
   * The caller's analytics capabilities (retention per data family, sampling ceiling), cached briefly. `fresh` reads
   * them again and caches the result.
   */
  getCapabilities(options?: { fresh?: boolean }): Promise<GetAnalyticsCapabilitiesResponse>;
  now(): Date;
};

/** Capabilities change only with the plan, so they are read at most this often. */
const CAPABILITIES_TTL_MS = 10 * 60_000;

/**
 * The context the analytics tools share. The organization slug and the capabilities are fetched once (capabilities
 * again after `CAPABILITIES_TTL_MS`); a failure is not cached, so the next call retries.
 */
export function createAnalyticsToolContext(deps: {
  server: McpServer;
  platform: Client['platform'];
  auth: AuthProvider;
  webURL: string;
  now?: () => Date;
}): AnalyticsToolContext {
  const client = createReadOnlyAnalyticsClient(deps.platform);
  const now = deps.now ?? (() => new Date());
  let organizationSlug: Promise<string> | undefined;
  let capabilities: { value: Promise<GetAnalyticsCapabilitiesResponse>; readAt: number } | undefined;
  return {
    server: deps.server,
    client,
    auth: deps.auth,
    webURL: deps.webURL,
    now,
    getOrgSlug: () => {
      organizationSlug ??= deps.auth
        .getHeaders()
        .then((headers) => client.whoAmI({}, { headers }))
        .then((resp) => resp.organizationSlug)
        .catch((error) => {
          organizationSlug = undefined;
          throw error;
        });
      return organizationSlug;
    },
    getCapabilities: (options) => {
      if (options?.fresh || !capabilities || now().getTime() - capabilities.readAt > CAPABILITIES_TTL_MS) {
        const value = deps.auth
          .getHeaders()
          .then((headers) => client.getAnalyticsCapabilities({}, { headers }))
          .then((resp) => {
            const error = checkResponse(resp, 'Analytics context');
            if (error) {
              throw new Error(error);
            }
            return resp;
          });
        value.catch(() => {
          capabilities = undefined;
        });
        capabilities = { value, readAt: now().getTime() };
      }
      return capabilities.value;
    },
  };
}

/**
 * Registers an analytics tool. Every analytics tool is read-only, and a failure (auth, network, ClickHouse
 * unavailable, bad input) becomes an error result for the model rather than an exception that ends the server.
 */
export function registerAnalyticsTool<Shape extends ZodRawShape>(
  ctx: AnalyticsToolContext,
  name: string,
  config: { title: string; description: string; inputSchema: Shape },
  handler: (input: ToolInput<Shape>, headers: Record<string, string>) => Promise<CallToolResult>,
) {
  ctx.server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    // The SDK derives the callback's input type from the shape, which TypeScript can't relate to a generic Shape.
    (async (input: ToolInput<Shape>) => {
      try {
        return await handler(input, await ctx.auth.getHeaders());
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }) as unknown as ToolCallback<Shape>,
  );
}

/** Tool input for a graph, shared by every graph-scoped tool. */
export const graphInput = {
  graph: z.string().describe('Name of the federated graph, monograph or contract.'),
  namespace: z.string().default('default').describe('Namespace of the graph. Defaults to "default".'),
};
