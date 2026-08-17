import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { Proposal } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const PROPOSALS_PAGE_SIZE = 50;

type FindProposalResult = { success: true; proposal: Proposal } | { success: false; details: string };

const findProposal = async (
  client: BaseCommandOptions['client'],
  {
    name,
    federatedGraphName,
    namespace,
    checkAllProposals,
  }: {
    name: string;
    federatedGraphName: string;
    namespace?: string;
    checkAllProposals: boolean;
  },
): Promise<FindProposalResult> => {
  let offset = 0;

  do {
    const resp = await client.platform.getProposalsByFederatedGraph(
      {
        federatedGraphName,
        namespace,
        limit: PROPOSALS_PAGE_SIZE,
        offset,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      return {
        success: false,
        details: resp.response?.details || `Failed to fetch proposal '${name}'.`,
      };
    }

    const proposal = resp.proposals.find((item) => item.name === name);
    if (proposal) {
      return { success: true, proposal };
    }

    if (!checkAllProposals) {
      break;
    }

    if (resp.proposals.length === 0) {
      break;
    }

    offset += resp.proposals.length;
    if (offset >= resp.totalCount) {
      break;
    }
  } while (true);

  return {
    success: false,
    details: `Proposal '${name}' not found.`,
  };
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('status');
  command.description(
    'Checks the status of an existing proposal for a federated graph. By default, only the 50 most recent proposals are checked. Checking all proposals can be slow.',
  );
  command.argument('<name>', 'The name of the proposal to check.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of text.');
  command.option(
    '--check-all-proposals',
    'Checks all proposals instead of only the 50 most recent proposals. This can be slow.',
  );

  command.action(async (name, options) => {
    let result: FindProposalResult;

    try {
      result = await findProposal(opts.client, {
        name,
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
        checkAllProposals: options.checkAllProposals,
      });
    } catch (error) {
      result = {
        success: false,
        details: error instanceof Error ? error.message : 'An unknown error occurred.',
      };
    }

    if (!result.success) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: 'error',
            details: result.details,
          }),
        );
      } else {
        console.error(pc.red(result.details));
      }
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(
        JSON.stringify({
          status: result.proposal.state,
        }),
      );
      return;
    }

    console.log(`Proposal '${name}' status is ${pc.bold(result.proposal.state)}.`);
  });

  return command;
};
