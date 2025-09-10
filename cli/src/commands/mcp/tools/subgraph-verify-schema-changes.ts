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
      schema: z.string().describe('The new schema SDL to check'),
      delete: z.boolean().optional().describe('Run checks in case the subgraph should be deleted'),
      skipTrafficCheck: z.boolean().optional().describe('Skip checking for client traffic'),
    },
    async (params) => {
      const resp = await opts.client.platform.checkSubgraphSchema(
        {
          subgraphName: params.name,
          namespace: params.namespace,
          schema: new Uint8Array(Buffer.from(params.schema)),
          delete: params.delete,
          skipTrafficCheck: params.skipTrafficCheck,
        },
        {
          headers: getBaseHeaders(),
        },
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...resp,
                isCheckSuccessful: isCheckSuccessful({
                  isComposable: resp.compositionErrors.length === 0,
                  isBreaking: resp.breakingChanges.length > 0,
                  hasClientTraffic:
                    (resp.operationUsageStats?.totalOperations ?? 0) > 0 &&
                    (resp.operationUsageStats?.totalOperations ?? 0) !==
                      (resp.operationUsageStats?.safeOperations ?? 0),
                  hasLintErrors: resp.lintErrors.length > 0,
                  hasGraphPruningErrors: resp.graphPruneErrors.length > 0,
                  clientTrafficCheckSkipped: resp.clientTrafficCheckSkipped === true,
                  hasProposalMatchError:
                    resp.response?.code === EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL,
                  isLinkedTrafficCheckFailed: resp.isLinkedTrafficCheckFailed,
                  isLinkedPruningCheckFailed: resp.isLinkedPruningCheckFailed,
                }),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};

const isCheckSuccessful = ({
  isComposable,
  isBreaking,
  hasClientTraffic,
  hasLintErrors,
  hasGraphPruningErrors,
  clientTrafficCheckSkipped,
  hasProposalMatchError,
  isLinkedTrafficCheckFailed,
  isLinkedPruningCheckFailed,
}: {
  isComposable: boolean;
  isBreaking: boolean;
  hasClientTraffic: boolean;
  hasLintErrors: boolean;
  hasGraphPruningErrors: boolean;
  clientTrafficCheckSkipped: boolean;
  hasProposalMatchError: boolean;
  isLinkedTrafficCheckFailed?: boolean;
  isLinkedPruningCheckFailed?: boolean;
}) => {
  // if a subgraph is linked to another subgraph, then the status of the check depends on the traffic and pruning check of the linked subgraph
  if (isLinkedTrafficCheckFailed || isLinkedPruningCheckFailed) {
    return false;
  }

  return (
    isComposable &&
    // If no breaking changes found
    // OR Breaking changes are found, but no client traffic is found and traffic check is not skipped
    (!isBreaking || (isBreaking && !hasClientTraffic && !clientTrafficCheckSkipped)) &&
    !hasLintErrors &&
    !hasGraphPruningErrors &&
    !hasProposalMatchError
  );
};
