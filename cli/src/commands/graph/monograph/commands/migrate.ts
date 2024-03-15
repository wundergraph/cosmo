import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import ora from 'ora';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('migrate');
  command.description('Migrates the monograph into a federated graph. This action is irreversible.');
  command.argument('<name>', 'The name of the monograph to migrate.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.action(async (name, options) => {
    const inquiry = await inquirer.prompt({
      name: 'confirmMigration',
      type: 'confirm',
      message: 'This action is irreversible. Are you sure you want to migrate this monograph?',
    });
    if (!inquiry.confirmMigration) {
      process.exit(1);
    }

    const spinner = ora('Monograph is being migrated...').start();

    const resp = await opts.client.platform.migrateMonograph(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    spinner.stop();

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(
        pc.green(
          `Successfully migrated ${pc.bold(
            name,
          )} into a federated graph. Please use the federated-graph commands from here on.`,
        ),
      );
    } else {
      program.error(pc.red(`Could not migrate monograph. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
