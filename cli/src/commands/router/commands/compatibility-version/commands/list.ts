import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all supported router compatibility versions.');
  command.action(async () => {
    const response = await opts.client.platform.listRouterCompatibilityVersions(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    if (response.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(response.response?.details));
      program.error(pc.red('Could not fetch router compatibility versions.'));
    }

    const versionsTable = new Table({
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    versionsTable.push([pc.bold(pc.white('VERSION')), ...response.versions]);

    console.log(`The router compatibility versions currently supported are:\n` + versionsTable.toString());
  });

  return command;
};
