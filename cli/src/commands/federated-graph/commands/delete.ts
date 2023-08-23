import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import inquirer from 'inquirer';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const deleteFederatedGraph = new Command('delete');
  deleteFederatedGraph.description('Deletes a federated graph on the control plane.');
  deleteFederatedGraph.argument('<name>', 'The name of the federated graph to delete.');
  deleteFederatedGraph.option('-f --force', 'Option to force delete');
  deleteFederatedGraph.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this federated graph?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }
    const resp = await opts.client.platform.deleteFederatedGraph(
      {
        name,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`A federated graph called '${name}' was deleted.`)));
    } else {
      console.log(`Failed to delete federated graph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return deleteFederatedGraph;
};
