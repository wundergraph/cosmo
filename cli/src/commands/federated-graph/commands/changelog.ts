import * as fs from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('changelog');
  command.description('Fetches the changelog for a federated graph');
  command.argument('<name>', 'The name of the federated graph to update.');
  command.option('-l, --limit [number]', 'Limit of entries. Defaults to 10', '10');
  command.option('-f, --offset [number]', 'Offset of entries. Defaults to 0', '0');
  command.option('-s, --start', 'Start date. Defaults to 3 days back');
  command.option('-e, --end', 'End date. Defaults to today');
  command.option('-o, --out', 'Destination file for changelog. Defaults to changelog.json');
  command.action(async (name, options) => {
    let startDate = subDays(new Date(), 3);
    let endDate = new Date();

    if (options.start) {
      startDate = new Date(options.start);
    }
    if (options.end) {
      endDate = new Date(options.end);
    }

    const resp = await opts.client.platform.getFederatedGraphChangelog(
      {
        name,
        pagination: {
          limit: Number(options.limit),
          offset: Number(options.offset),
        },
        dateRange: {
          start: formatISO(startOfDay(startDate)),
          end: formatISO(endOfDay(endDate)),
        },
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      fs.writeFileSync(options.out || './changelog.json', JSON.stringify(resp.federatedGraphChangelogOutput));
    } else {
      console.log(`Failed to fetch changelog for ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
