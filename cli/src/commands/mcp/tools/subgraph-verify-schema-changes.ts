import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { z } from 'zod';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { ToolContext } from './types.js';

export const registerSubgraphVerifySchemaChangesTool = ({ server, opts }: ToolContext) => {
  server.tool(
    'verify_subgraph_schema_changes',
    'When making changes to a Subgraph Schema, this command can validate if the schema is valid GraphQL SDL, if it composes with all other subgraphs into a valid supergraph, and if there are any breaking changes.',
    {
      name: z.string().describe('The name of the subgraph'),
      namespace: z.string().optional().describe('The namespace of the subgraph'),
      schema: z.string().optional().describe('The new schema SDL to check'),
      delete: z.boolean().optional().describe('Run checks in case the subgraph should be deleted'),
      skipTrafficCheck: z.boolean().optional().describe('Skip checking for client traffic'),
    },
    async (params) => {
      const schema = params.schema ? Buffer.from(params.schema) : Buffer.from('');

      const resp = await opts.client.platform.checkSubgraphSchema(
        {
          subgraphName: params.name,
          namespace: params.namespace,
          schema: new Uint8Array(schema),
          delete: params.delete,
          skipTrafficCheck: params.skipTrafficCheck,
        },
        {
          headers: getBaseHeaders(),
        },
      );

      // Format the check results in a readable way
      const formatResults = () => {
        const results: string[] = [];

        if (resp.compositionErrors?.length) {
          results.push('Composition Errors:');
          for (const error of resp.compositionErrors) {
            results.push(`- ${error.message}`);
          }
        }

        if (resp.breakingChanges?.length) {
          results.push('\nBreaking Changes:');
          for (const change of resp.breakingChanges) {
            results.push(`- ${change.message} (${change.changeType})`);
          }
        }

        if (resp.nonBreakingChanges?.length) {
          results.push('\nNon-Breaking Changes:');
          for (const change of resp.nonBreakingChanges) {
            results.push(`- ${change.message} (${change.changeType})`);
          }
        }

        if (resp.compositionWarnings?.length) {
          results.push('\nComposition Warnings:');
          for (const warning of resp.compositionWarnings) {
            results.push(`- ${warning.message}`);
          }
        }

        if (results.length === 0) {
          results.push('No issues found - schema is valid!');
        }

        return results.join('\n');
      };

      return {
        content: [{ type: 'text', text: formatResults() }],
      };
    },
  );
};
