import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import { endOfDay, formatISO, startOfDay, subDays, format, parse, isValid } from 'date-fns';
import pc from 'picocolors';
import { resolve } from 'pathe';
import { getBaseHeaders } from '../../../core/config.js';
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

const logInfo = (msg: string) => console.log(pc.yellow(msg));
const exitWithError = (msg: string) => program.error(pc.red(msg));

const parseAndValidateDate = (input: string, label: string): Date => {
  const parsed = parse(input, 'yyyy-MM-dd', new Date());
  if (!isValid(parsed)) {
    exitWithError(`Invalid ${label} date "${input}". Please use YYYY-MM-DD format.`);
  }
  return parsed;
};
const parseAndValidateNumber = (input: string, label: string): number => {
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) {
    exitWithError(`Invalid ${label} "${input}". Please provide a positive number.`);
  }
  return num;
};

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('changelog');
  command.description(`Fetches the changelog for a ${graphType}`);
  command.argument('<name>', `The name of the ${graphType} to update.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('-l, --limit [number]', 'Limit of entries. Defaults to 10', '10');
  command.option('-f, --offset [number]', 'Offset of entries. Defaults to 0', '0');
  command.option('-s, --start [date]', 'Start date (YYYY-MM-DD). Defaults to 3 days back');
  command.option('-e, --end [date]', 'End date (YYYY-MM-DD). Defaults to today');
  command.option('-o, --out [string]', 'Destination file. Defaults to changelog.json', 'changelog.json');
  command.action(async (name, options) => {
    const limit = parseAndValidateNumber(options.limit, 'limit');
    const offset = parseAndValidateNumber(options.offset, 'offset');
    let endDate = options.end ? parseAndValidateDate(options.end, 'end') : new Date();
    const startDate = options.start ? parseAndValidateDate(options.start, 'start') : subDays(endDate, 3);

    if (options.end && !options.start) {
      logInfo(
        `Only end date provided. Defaulting start date to "${format(startDate, 'dd-MMM-yyyy')}", end date is "${format(endDate, 'dd-MMM-yyyy')}"`,
      );
    } else if (options.start && !options.end) {
      endDate = subDays(startDate, -3);
      logInfo(
        `Only start date provided. Defaulting end date to "${format(endDate, 'dd-MMM-yyyy')}", start date is "${format(startDate, 'dd-MMM-yyyy')}"`,
      );
    } else if (!options.start) {
      logInfo(`Using default start date: "${format(startDate, 'dd-MMM-yyyy')}"`);
    }

    if (!options.end && !options.start) {
      logInfo(`Using default end date: "${format(endDate, 'dd-MMM-yyyy')}"`);
    }

    if (startDate > endDate) {
      exitWithError(
        `Start date "${format(startDate, 'yyyy-MM-dd')}" cannot be after end date "${format(endDate, 'yyyy-MM-dd')}".`,
      );
    }

    const resp = await opts.client.platform.getFederatedGraphChangelog(
      {
        name,
        pagination: { limit, offset },
        dateRange: {
          start: formatISO(startOfDay(startDate)),
          end: formatISO(endOfDay(endDate)),
        },
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
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
      await writeFile(resolve(options.out), JSON.stringify(output));
      console.log(pc.green(`Successfully wrote changelog to '${options.out}'`));
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
