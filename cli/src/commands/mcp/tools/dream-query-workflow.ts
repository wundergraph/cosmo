import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BaseCommandOptions } from '../../../core/types/types.js';

/**
 * Registers the dream-query-workflow tool with the MCP server.
 *
 * @param params - The parameters for registration.
 * @param params.server - The MCP server instance.
 * @param params.opts - Base command options.
 */
export const registerDreamQueryWorkflowTool = ({ server, opts }: { server: McpServer; opts: BaseCommandOptions }) => {
  server.tool(
    'dream_query_workflow',
    "Use this tool to generate a list of instructions to make the necessary changes to a Supergraph to support a given GraphQL query. Ask the user to provide the Supergraph name and namespace if it's not clear.",
    { query: z.string(), supergraph: z.string(), namespace: z.string().optional() },
    ({ query, supergraph, namespace }) => ({
      content: [
        {
          type: 'text',
          text: `
                        You are an expert GraphQL developer.
                        You are given a GraphQL query and a Supergraph.
                        Your task is to generate a list of instructions to make the necessary changes to the Supergraph to support the query.

                        Scope:
                        Supergraph: ${supergraph}, namespace: ${namespace ?? 'default'}

                        Given the following Query:

                        \`\`\`graphql
                        ${query}
                        \`\`\`

                        Validate the Query against the Supergraph.
                        If it's invalid because fields are missing,
                        make changes to the schema until it's valid.
                        Once you know the changes for the Supergraph,
                        use the "schema_change_proposal" flow to propose the necessary changes.
                    `,
        },
      ],
    }),
  );
};
