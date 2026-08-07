import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const proposalStatuses = ['APPROVED', 'CLOSED'] as const;
type ProposalStatus = (typeof proposalStatuses)[number];

const parseProposalStatus = (value: string): ProposalStatus => {
  const status = value.toUpperCase();
  if (!proposalStatuses.includes(status as ProposalStatus)) {
    throw new InvalidArgumentError('Allowed values are approved and closed.');
  }
  return status as ProposalStatus;
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('update-status');
  command.description('Updates the status of an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to update.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.requiredOption(
    '-s, --status <status>',
    'The status to set. Allowed values: approved, closed.',
    parseProposalStatus,
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.', 'default');

  command.action(async (name, options) => {
    const resp = await opts.client.platform.updateProposal(
      {
        proposalName: name,
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
        updateAction: {
          case: 'state',
          value: options.status,
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green(`Proposal '${name}' status was updated to ${options.status} successfully.`));
      return;
    }

    console.error(pc.red(resp.response?.details || `Failed to update status for proposal '${name}'.`));
    process.exitCode = 1;
  });

  return command;
};
