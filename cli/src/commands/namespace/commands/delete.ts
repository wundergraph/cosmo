import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a namespace and all resources in it.');
  command.argument('<name>', 'The name of the namespace to delete.');
  command.option('-f --force', 'Option to force delete');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'All resources within the namespace will be deleted. Are you sure you want to proceed?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }

    const resp = await opts.client.platform.deleteNamespace(
      {
        name,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(`${pc.green(`Successfully deleted namespace ${pc.bold(name)}.`)}`);
    } else {
      program.error(pc.red(`Could not delete namespace. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
