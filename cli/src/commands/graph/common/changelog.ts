import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns';
import pc from 'picocolors';
import { join } from 'pathe';
import { baseHeaders } from '../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../core/types/types.js';

type OutputFile = {
  createdAt: string;
  schemaVersionId: string;
  changelogs: {
    id: string;
    path: string;
    changeType: string;
    changeMessage: string;
    createdAt: string;
  }[];
}[];

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('changelog');
  command.description(`Fetches the changelog for a ${graphType}`);
  command.argument('<name>', `The name of the ${graphType} to update.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('-l, --limit [number]', 'Limit of entries. Defaults to 10', '10');
  command.option('-f, --offset [number]', 'Offset of entries. Defaults to 0', '0');
  command.option('-s, --start [date]', 'Start date. Defaults to 3 days back');
  command.option('-e, --end [date]', 'End date. Defaults to today');
  command.option('-o, --out [string]', 'Destination file for changelog. Defaults to changelog.json', 'changelog.json');
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
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      const output = resp.federatedGraphChangelogOutput.map(
        (op) =>
          ({
            createdAt: op.createdAt,
            schemaVersionId: op.schemaVersionId,
            changelogs: op.changelogs.map((cl) => ({
              id: cl.id,
              path: cl.path,
              changeType: cl.changeType,
              changeMessage: cl.changeMessage,
              createdAt: cl.createdAt,
            })),
          }) as OutputFile[number],
      );
      await writeFile(join(process.cwd(), options.out), JSON.stringify(output));
    } else {
      let message = `Failed to fetch changelog for ${pc.bold(name)}.`;
      if (resp.response?.details) {
        message += pc.red(pc.bold(resp.response?.details));
      }
      program.error(message);
    }
  });

  return command;
};
