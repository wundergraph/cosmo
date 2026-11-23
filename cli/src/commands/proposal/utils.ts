import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { create } from '@bufbuild/protobuf';
import { program } from 'commander';
import pc from 'picocolors';
import { resolve } from 'pathe';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { LabelSchema } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { Label, Proposal } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import type { Client } from '../../core/client/client.js';
import { getBaseHeaders } from '../../core/config.js';

export const getProposalsByFederatedGraph = ({
  client,
  federatedGraphName,
  namespace,
  proposalName,
  startDate,
  endDate,
  limit,
  offset,
}: {
  client: Client;
  federatedGraphName: string;
  namespace?: string;
  proposalName?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) => {
  return client.platform.getProposalsByFederatedGraph(
    {
      federatedGraphName,
      namespace,
      proposalName,
      startDate,
      endDate,
      limit,
      offset,
    },
    {
      headers: getBaseHeaders(),
    },
  );
};

const CONTROL_PLANE_MAX_PAGE_SIZE = 50;

const MAX_PROPOSAL_PAGES = 200;

type FetchAllProposalsResult =
  | { success: true; proposals: Proposal[] }
  | { success: false; code: EnumStatusCode; details: string };

export const fetchAllProposals = async (
  client: Client,
  { federatedGraphName, namespace }: { federatedGraphName: string; namespace: string },
): Promise<FetchAllProposalsResult> => {
  const proposals = new Map<string, Proposal>();

  try {
    for (let page = 0; page < MAX_PROPOSAL_PAGES; page++) {
      const resp = await getProposalsByFederatedGraph({
        client,
        federatedGraphName,
        namespace,
        limit: CONTROL_PLANE_MAX_PAGE_SIZE,
        offset: page * CONTROL_PLANE_MAX_PAGE_SIZE,
      });

      if (resp.response?.code !== EnumStatusCode.OK) {
        return {
          success: false,
          code: resp.response?.code ?? EnumStatusCode.ERR,
          details: resp.response?.details || 'Failed to fetch proposals.',
        };
      }

      // A proposal created mid-listing shifts the offsets, so one already seen can come back on the next page. Counting
      // each id once makes the listing fall short of the total and fail, rather than print a duplicate.
      const knownBefore = proposals.size;
      for (const proposal of resp.proposals) {
        proposals.set(proposal.id, proposal);
      }
      const newOnThisPage = proposals.size - knownBefore;

      if (proposals.size >= resp.totalCount) {
        return { success: true, proposals: [...proposals.values()] };
      }

      if (newOnThisPage === 0) {
        return {
          success: false,
          code: EnumStatusCode.ERR,
          details: 'The proposals changed while they were being listed. Run the command again.',
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      code: EnumStatusCode.ERR,
      details: error instanceof Error ? error.message : 'An unknown error occurred.',
    };
  }

  return {
    success: false,
    code: EnumStatusCode.ERR,
    details: `The graph has more than ${MAX_PROPOSAL_PAGES * CONTROL_PLANE_MAX_PAGE_SIZE} proposals, which is more than this command can list.`,
  };
};

// Define interfaces for parsing parameters
interface SubgraphParams {
  name: string;
  schemaPath: string;
  [key: string]: string;
}

export const processProposalSubgraphs = async ({
  subgraphs,
  newSubgraphs,
  deletedSubgraphs,
}: {
  subgraphs: string[];
  newSubgraphs: string[];
  deletedSubgraphs: string[];
}) => {
  const processedSubgraphs = [];
  // Process subgraphs to include in the proposal
  for (const subgraphOption of subgraphs) {
    const parts = subgraphOption.split(',');
    const params: SubgraphParams = { name: '', schemaPath: '' };

    for (const part of parts) {
      const [key, value] = part.split(':');
      if (key && value) {
        params[key] = value;
      }
    }

    if (!params.name || !params.schemaPath) {
      program.error(
        pc.red(
          pc.bold(
            `Invalid subgraph format: ${subgraphOption}. Expected format is name:subgraph-name,schemaPath:path-to-schema.`,
          ),
        ),
      );
    }

    const resolvedSchemaPath = resolve(params.schemaPath);
    if (!existsSync(resolvedSchemaPath)) {
      program.error(
        pc.red(
          pc.bold(
            `The schema file '${pc.bold(resolvedSchemaPath)}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }

    const schemaBuffer = await readFile(resolvedSchemaPath);
    const schema = new TextDecoder().decode(schemaBuffer);
    if (schema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The schema file '${pc.bold(resolvedSchemaPath)}' is empty. Please provide a valid schema.`)),
      );
    }
    processedSubgraphs.push({
      name: params.name,
      schemaSDL: schema,
      isDeleted: false,
      isNew: false,
      labels: [],
    });
  }

  // Process new subgraphs with labels
  for (const subgraphOption of newSubgraphs || []) {
    const parts = subgraphOption.split(',');
    const params: SubgraphParams = { name: '', schemaPath: '' };
    let labels: Label[] = [];

    for (const part of parts) {
      if (part.startsWith('labels:')) {
        const labelsStr = part.slice('labels:'.length);
        const labelStrings = labelsStr.trim().split(' ');
        labels = labelStrings.map((label: string) => create(LabelSchema, splitLabel(label)));
      } else {
        const [key, value] = part.split(':');
        if (key && value) {
          params[key] = value;
        }
      }
    }

    if (!params.name || !params.schemaPath) {
      program.error(
        pc.red(
          pc.bold(
            `Invalid new-subgraph format: ${subgraphOption}. Expected format is name:subgraph-name,schemaPath:path-to-schema,labels:key=value key=value.`,
          ),
        ),
      );
    }

    const resolvedSchemaPath = resolve(params.schemaPath);
    if (!existsSync(resolvedSchemaPath)) {
      program.error(
        pc.red(
          pc.bold(
            `The schema file '${pc.bold(resolvedSchemaPath)}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }

    const schemaBuffer = await readFile(resolvedSchemaPath);
    const schema = new TextDecoder().decode(schemaBuffer);
    if (schema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The schema file '${pc.bold(resolvedSchemaPath)}' is empty. Please provide a valid schema.`)),
      );
    }
    processedSubgraphs.push({
      name: params.name,
      schemaSDL: schema,
      isDeleted: false,
      isNew: true,
      labels,
    });
  }

  // Process subgraphs to delete in the proposal
  for (const subgraphName of deletedSubgraphs) {
    processedSubgraphs.push({
      name: subgraphName,
      schemaSDL: '',
      isDeleted: true,
      isNew: false,
      labels: [],
    });
  }

  return processedSubgraphs;
};
