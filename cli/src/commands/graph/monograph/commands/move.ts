import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import CliTable3 from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('move');
  command.description('Moves the monograph from one namespace to another.');
  command.argument('<name>', 'The name of the monograph to move.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.requiredOption('-t, --to [string]', 'The new namespace of the monograph.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.moveMonograph(
      {
        name,
        namespace: options.namespace,
        newNamespace: options.to,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green(`Successfully moved graph to namespace ${pc.bold(options.to)}.`));
    } else {
      program.error(pc.red(`Could not move monograph. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
