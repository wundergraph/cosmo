import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import CliTable3 from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('migrate');
  command.description('Migrates the monograph into a federated graph.');
  command.argument('<name>', 'The name of the monograph to migrate.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.migrateMonograph(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

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
