import { Command } from 'commander';
import ora from 'ora';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('close');
  command.description('Closes an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to close.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');

  command.action(async (name, options) => {
    const spinner = ora(`Closing proposal: ${name}...`).start();

    const resp = await opts.client.platform.updateProposal(
      {
        proposalName: name,
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
        updateAction: {
          case: 'state',
          value: 'CLOSED',
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    spinner.stop();

    const result = handleProposalResult(resp, name, false);

    if (result.success) {
      if (result.message) {
        console.log(result.message);
      }
    } else {
      if (result.message) {
        console.error(result.message);
      }
      process.exitCode = 1;
    }
  });

  return command;
};
