import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('approve');
  command.description('Approves an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to approve.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
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
          value: 'APPROVED',
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green(`Proposal '${name}' was approved successfully.`));
      return;
    }

    console.error(pc.red(resp.response?.details || `Failed to approve proposal '${name}'.`));
    process.exitCode = 1;
  });

  return command;
};
