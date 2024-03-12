import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import { baseHeaders } from '../../../../core/config.js';
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
    const resp = await opts.client.platform.deleteMonograph(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`A monograph called '${name}' was deleted.`)));
    } else {
      console.log(`Failed to delete monograph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
