import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import ora from 'ora';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a federated graph on the control plane.');
  command.argument('<name>', 'The name of the federated graph to delete.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
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

    const spinner = ora('Federated Graph is being deleted...').start();
    const resp = await opts.client.platform.deleteFederatedGraph(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed(`Federated Graph was deleted successfully.`);
    } else {
      spinner.fail(`Failed to delete federated graph.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
