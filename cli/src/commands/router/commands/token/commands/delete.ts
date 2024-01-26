import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { baseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a router token of a federated graph.');
  command.argument('<name>', 'The name of the router token.');
  command.requiredOption('-g, --graph-name <graphName>', 'The name of the federated graph the token belongs to');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this router token?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }
    const resp = await opts.client.platform.deleteRouterToken(
      {
        tokenName: name,
        fedGraphName: options.graphName,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`A router token called '${name}' was deleted.`)));
    } else {
      console.log(`Failed to delete router token ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
