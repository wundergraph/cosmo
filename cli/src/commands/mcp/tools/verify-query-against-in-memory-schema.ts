import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parse, validate, GraphQLError } from 'graphql';
import type { BaseCommandOptions } from '../../../core/types/types.js';
import { buildSchemaWithoutDirectives } from './utils/schema.js';

/**
 * Registers the verify-query-against-in-memory-schema tool with the MCP server.
 *
 * @param params - The parameters for registration.
 * @param params.server - The MCP server instance.
 * @param params.opts - Base command options.
 */
export const registerVerifyQueryAgainstInMemorySchemaTool = ({
  server,
  opts,
}: {
  server: McpServer;
  opts: BaseCommandOptions;
}) => {
  server.tool(
    'verify_query_against_in_memory_schema',
    'Verify if a GraphQL query is valid against a local in memory Supergraph or GraphQL SDL.',
    { query: z.string(), schema: z.string() },
    ({ query, schema: schemaString }) => {
      try {
        let document;
        try {
          document = parse(query);
        } catch (syntaxError: any) {
          return {
            content: [{ type: 'text', text: `Query parsing failed:\n${syntaxError.message}` }],
          };
        }

        // Build the schema from the string, removing all directives
        let schema;
        try {
          schema = buildSchemaWithoutDirectives(schemaString);
        } catch (schemaError: any) {
          return {
            content: [{ type: 'text', text: schemaError.message }],
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
        // Handle other unexpected errors
        return {
          content: [{ type: 'text', text: `An unexpected error occurred: ${error.message}` }],
        };
      }
    },
  );
};
