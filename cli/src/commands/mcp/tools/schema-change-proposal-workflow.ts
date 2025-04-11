import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BaseCommandOptions } from '../../../core/types/types.js';

/**
 * Registers the schema-change-proposal-workflow tool with the MCP server.
 *
 * @param params - The parameters for registration.
 * @param params.server - The MCP server instance.
 * @param params.opts - Base command options.
 */
export const registerSchemaChangeProposalWorkflowTool = ({
  server,
  opts,
}: {
  server: McpServer;
  opts: BaseCommandOptions;
}) => {
  server.tool(
    'schema_change_proposal_workflow',
    'Use this tool to generate a list of instructions to make a successful schema change for a Supergraph.',
    { change: z.string(), supergraph: z.string(), namespace: z.string().optional() },
    ({ change, supergraph, namespace }) => ({
      content: [
        {
          type: 'text',
          text: `Load the schema of the ${supergraph} Supergraph ${namespace ? `in the namespace ${namespace}` : ''}.
                            Next, load all subgraphs of the ${supergraph} Supergraph.
                            Then analyze which Subgraphs could be best to make the proposed changed by the user:
                            ${change}
                            Finally, use the subgraph-verify-schema changes tool to verify the changes.
                            If the validation fails, try to use the error messages to propose a new schema change.
                            If the validation succeeds, return the list of subgraphs that should make the change.
                            Print out all diffs of the schema changes for each subgraph.
                            Additionally, print out the diff of the supergraph.`,
        },
      ],
    }),
  );
};
