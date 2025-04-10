import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { introspectSubgraph } from '../../../utils.js';

/**
 * Zod schema for the introspect subgraph tool input.
 * @property routingUrl - The routing URL of the subgraph.
 * @property header - Optional headers for introspection.
 * @property useRawIntrospection - Optional flag to use raw introspection query.
 */
export const introspectSubgraphInputSchema = z.object({
  routingUrl: z.string().describe('The routing url of your subgraph.'),
  header: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional()
    .describe('Headers to apply during introspection'),
  useRawIntrospection: z.boolean().optional().describe('Use the standard introspection query.'),
});

/**
 * Type inferred from the introspect subgraph input schema.
 */
export type IntrospectSubgraphInput = z.infer<typeof introspectSubgraphInputSchema>;

/**
 * Registers the introspect subgraph tool with the MCP server.
 *
 * @param config - Configuration object containing the MCP server and base command options.
 * @param config.server - The MCP server instance.
 * @param config.opts - Base command options.
 */
export const registerIntrospectSubgraphTool = ({ server, opts }: { server: McpServer; opts: BaseCommandOptions }) => {
  server.tool(
    'introspect_subgraph', // Tool name
    'Introspects a subgraph and returns its GraphQL schema (SDL).', // Tool description
    introspectSubgraphInputSchema.shape, // Pass the raw shape
    async ({ routingUrl, header, useRawIntrospection }: IntrospectSubgraphInput) => {
      // Destructure input fields directly
      try {
        const resp = await introspectSubgraph({
          subgraphURL: routingUrl, // Use destructured variable
          additionalHeaders: header || [],
          rawIntrospection: useRawIntrospection, // Use destructured variable
        });

        if (resp.success !== true || !resp.sdl) {
          // Throw error on failure
          throw new Error(`Could not introspect subgraph at ${routingUrl}. ${resp.errorMessage || 'Unknown error'}`); // Use destructured variable
        }

        // Return result wrapped in content object
        return {
          content: [{ type: 'text', text: resp.sdl }],
        };
      } catch (error: any) {
        // Rethrow caught errors
        throw new Error(`Failed to introspect subgraph: ${error.message || error}`);
      }
    },
  );
};
