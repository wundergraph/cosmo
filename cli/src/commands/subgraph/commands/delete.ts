import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a subgraph on the control plane.');
  command.argument('<name>', 'The name of the subgraph to delete.');
  command.option('-ns, --namespace [string]', 'The namespace of the subgraph. Fallback to "default"', 'default');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this subgraph?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }

    const resp = await opts.client.platform.deleteFederatedSubgraph(
      {
        subgraphName: name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`Subgraph '${name}' was deleted.`)));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      const compositionErrorsTable = new Table({
        head: [
          pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
          pc.bold(pc.white('NAMESPACE')),
          pc.bold(pc.white('ERROR_MESSAGE')),
        ],
        colWidths: [30, 120],
        wordWrap: true,
      });

      console.log(
        pc.red(
          `We found composition errors, while composing the federated graph.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
            'Please check the errors below:',
          )}`,
        ),
      );
      for (const compositionError of resp.compositionErrors) {
        compositionErrorsTable.push([
          compositionError.federatedGraphName,
          compositionError.namespace,
          compositionError.message,
        ]);
      }
      // Don't exit here with 1 because the change was still applied
      console.log(compositionErrorsTable.toString());
    } else {
      console.log(pc.red(`Failed to delete subgraph ${pc.bold(name)}.`));
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
