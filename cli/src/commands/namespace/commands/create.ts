import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description(
    'Creates a new namespace. This helps you scope your graphs so you can isolate into different environments.',
  );
  command.argument('<name>', 'The name of the namespace to create.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.createNamespace(
      {
        name,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(`Could not create namespace. ${resp.response?.details ?? ''}`));
    }

    console.log(`${pc.green(`Successfully created namespace ${pc.bold(name)}.`)}`);
  });

  return command;
};
