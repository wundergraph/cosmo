import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import ora from 'ora';
import { getBaseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a monograph on the control plane.');
  command.argument('<name>', 'The name of the monograph to delete.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this monograph?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }

    const spinner = ora('Monograph is being deleted...').start();

    const resp = await opts.client.platform.deleteMonograph(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed(`Monograph was deleted successfully.`);
    } else {
      spinner.fail(`Failed to delete monograph.`);
      program.error(pc.red(pc.bold(resp.response?.details ?? '')));
    }
  });

  return command;
};
