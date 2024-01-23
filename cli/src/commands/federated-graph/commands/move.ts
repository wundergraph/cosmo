import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import CliTable3 from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('move');
  command.description('Moves the federated graph from one namespace to another.');
  command.argument('<name>', 'The name of the federated graph to move.');
  command.option('-ns, --namespace', 'The namespace of the federated graph. Fallback to "default"', 'default');
  command.requiredOption('-t, --to [string]', 'The new namespace of the federated graph.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.moveFederatedGraph(
      {
        name,
        namespace: options.namespace,
        newNamespace: options.to,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green(`Successfully moved graph to namespace ${pc.bold(options.to)}.`));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      console.log(pc.dim(`Successfully moved graph to namespace ${pc.bold(options.to)}.`));

      const compositionErrorsTable = new CliTable3({
        head: [pc.bold(pc.white('FEDERATED_GRAPH_NAME')), pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [30, 120],
        wordWrap: true,
      });

      console.log(
        pc.yellow(
          'But we found composition errors, while composing the federated graph.\nThe graph will not be updated until the errors are fixed. Please check the errors below:',
        ),
      );
      for (const compositionError of resp.compositionErrors) {
        compositionErrorsTable.push([compositionError.federatedGraphName, compositionError.message]);
      }
      // Don't exit here with 1 because the change was still applied
      console.log(compositionErrorsTable.toString());
    } else {
      program.error(pc.red(`Could not move federated graph. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
