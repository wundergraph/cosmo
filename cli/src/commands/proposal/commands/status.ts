import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { Proposal } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getProposalsByFederatedGraph } from '../utils.js';

type FindProposalResult = { success: true; proposal: Proposal } | { success: false; details: string };

const findProposal = async (
  client: BaseCommandOptions['client'],
  {
    name,
    federatedGraphName,
    namespace,
  }: {
    name: string;
    federatedGraphName: string;
    namespace?: string;
  },
): Promise<FindProposalResult> => {
  const resp = await getProposalsByFederatedGraph({
    client,
    federatedGraphName,
    namespace,
    proposalName: name,
    limit: 1,
    offset: 0,
  });

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

  return {
    success: false,
    details: `Proposal '${name}' not found.`,
  };
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('status');
  command.description('Checks the status of an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to check.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of text.');

  command.action(async (name, options) => {
    let result: FindProposalResult;

    try {
      result = await findProposal(opts.client, {
        name,
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
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

    console.log(`Proposal '${name}' status is ${result.proposal.state}.`);
  });

  return command;
};
