import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildSchema, parse, validate, GraphQLError } from 'graphql';
import type { BaseCommandOptions } from '../../../core/types/types.js';
import { getFederatedGraphSchemas } from '../../graph/federated-graph/utils.js'; // Adjusted path

/**
 * Registers the verify-query-against-remote-schema tool with the MCP server.
 *
 * @param params - The parameters for registration.
 * @param params.server - The MCP server instance.
 * @param params.opts - Base command options.
 */
export const registerVerifyQueryAgainstRemoteSchemaTool = ({
  server,
  opts,
}: {
  server: McpServer;
  opts: BaseCommandOptions;
}) => {
  server.tool(
    'verify_query_against_remote_schema',
    'Verify if a GraphQL query is valid against a remote Supergraph.',
    { query: z.string(), supergraph: z.string(), namespace: z.string().optional() },
    async ({ query, supergraph, namespace }) => {
      try {
        const fedGraphSchemas = await getFederatedGraphSchemas({
          client: opts.client,
          name: supergraph,
          namespace,
        });

        const schema = buildSchema(fedGraphSchemas.sdl);

        // Parse the query
        let document;
        try {
          document = parse(query);
        } catch (syntaxError: any) {
          return {
            content: [{ type: 'text', text: `Query parsing failed:\n${syntaxError.message}` }],
          };
        }

        // Validate the query against the schema
        const validationErrors = validate(schema, document);

        if (validationErrors.length > 0) {
          const errorMessages = validationErrors
            .map((error: GraphQLError) => {
              const locations =
                error.locations?.map((loc) => `line ${loc.line}, column ${loc.column}`).join(', ') ||
                'unknown location';
              return `- ${error.message} (at ${locations})`;
            })
            .join('\n');
          return {
            content: [{ type: 'text', text: `Query validation failed:\n${errorMessages}` }],
          };
        }

        return {
          content: [{ type: 'text', text: 'Query is valid against the schema.' }],
        };
      } catch (error: any) {
        // Handle schema building errors or other unexpected errors
        return {
          content: [{ type: 'text', text: `An error occurred: ${error.message}` }],
        };
      }
    },
  );
};
