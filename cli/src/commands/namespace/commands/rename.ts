import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('rename');
  command.description('Renames a namespace.');
  command.argument('<name>', 'The name of the namespace to rename.');
  command.requiredOption('-t, --to [string]', 'The new name for the namespace.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.renameNamespace(
      {
        name,
        newName: options.to,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(`${pc.green(`Successfully renamed namespace ${pc.bold(name)} to ${pc.bold(options.to)}.`)}`);
    } else {
      program.error(pc.red(`Could not rename namespace. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
