import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';
import program from '../../../../index.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all supported router compatibility versions.');
  command.action(async () => {
    const resp = await opts.client.platform.listRouterCompatibilityVersions(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch router compatibility versions.'));
    }

    const versionsTable = new Table({
      head: [pc.bold(pc.white('VERSION'))],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    versionsTable.push([...resp.versions]);

    console.log(`The router compatibility versions currently supported are:\n` + versionsTable.toString());
  });

  return command;
};
