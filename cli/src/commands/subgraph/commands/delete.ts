import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const deleteSubgraph = new Command('delete');
  deleteSubgraph.description('Deletes a subgraph on the control plane.');
  deleteSubgraph.argument('<name>', 'The name of the subgraph to delete.');
  deleteSubgraph.option('-f --force', 'Option to force delete');
  deleteSubgraph.action(async (name, options) => {
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
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`A subgraph called '${name}' was deleted.`)));
    } else {
      console.log(`Failed to delete subgraph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return deleteSubgraph;
};
