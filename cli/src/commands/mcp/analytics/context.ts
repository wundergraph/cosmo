import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import type { AuthProvider } from '../auth.js';
import type { ReadOnlyAnalyticsClient } from './client.js';
import { fail } from './envelope.js';

export type AnalyticsToolContext = {
  server: McpServer;
  client: ReadOnlyAnalyticsClient;
  auth: AuthProvider;
  webURL: string;
  getOrgSlug(): Promise<string>;
  now(): Date;
};

/**
 * Registers an analytics tool. Every analytics tool is read-only, and a failure (auth, network, ClickHouse
 * unavailable, bad input) becomes an error result for the model rather than an exception that ends the server.
 */
export function registerAnalyticsTool<Shape extends ZodRawShape>(
  ctx: AnalyticsToolContext,
  name: string,
  config: { title: string; description: string; inputSchema: Shape },
  handler: (input: z.objectOutputType<Shape, z.ZodTypeAny>, headers: Record<string, string>) => Promise<CallToolResult>,
) {
  ctx.server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (async (input: z.objectOutputType<Shape, z.ZodTypeAny>) => {
      try {
        return await handler(input, await ctx.auth.getHeaders());
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }) as any,
  );
}

/** Tool input for a graph, shared by every graph-scoped tool. */
export const graphInput = {
  graph: z.string().describe('Name of the federated graph, monograph or contract.'),
  namespace: z.string().default('default').describe('Namespace of the graph. Defaults to "default".'),
};
