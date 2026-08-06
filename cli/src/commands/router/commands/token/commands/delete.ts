import { Command } from 'commander';
import pc from 'picocolors';
import inquirer from 'inquirer';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { deleteRouterToken } from '../../../../../core/router-token.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a router token of a federated graph or monograph.');
  command.argument('<name>', 'The name of the router token.');
  command.requiredOption(
    '-g, --graph-name <graphName>',
    'The name of the federated graph or monograph the token belongs to',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this router token?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exitCode = 1;
        return;
      }
    }

    const result = await deleteRouterToken({
      client: opts.client,
      tokenName: name,
      graphName: options.graphName,
      namespace: options.namespace,
    });

    if (result.error) {
      console.log(`Failed to delete router token ${pc.bold(name)}.`);
      if (result.error.message) {
        console.log(pc.red(pc.bold(result.error.message)));
      }
      process.exitCode = 1;
      return;
    }

    console.log(pc.dim(pc.green(`A router token called '${name}' was deleted.`)));
  });

  return command;
};
