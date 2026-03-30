import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import pc from 'picocolors';
import Table from 'cli-table3';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { resolve } from 'pathe';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

type OutputFile = {
  name: string;
  namespace: string;
  labels: string[];
  isEnabled: boolean;
  lastUpdatedAt: string;
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists the feature flags.');
  command.option(
    '-n, --namespace [string]',
    'The namespace of the feature flags. If not provided, it will list all feature flags.',
  );
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.action(async (options) => {
    const resp = await opts.client.platform.getFeatureFlags(
      {
        namespace: options.namespace,
        limit: 0,
        offset: 0,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(`Could not fetch feature flags. ${resp.response?.details ?? ''}`));
    }

    if (options.out) {
      const output = resp.featureFlags.map(
        (f) =>
          ({
            name: f.name,
            labels: f.labels.map((l) => joinLabel(l)),
            isEnabled: f.isEnabled,
            lastUpdatedAt: f.updatedAt,
            namespace: f.namespace,
          }) as OutputFile[number],
      );
      await writeFile(resolve(options.out), JSON.stringify(output));
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(resp.featureFlags));
      return;
    }

    const featureFlagsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('LABELS')),
        pc.bold(pc.white('ENABLED')),
        pc.bold(pc.white('UPDATED_AT')),
      ],
      colWidths: [20, 20, 30, 15, 30],
      wordWrap: true,
    });

    for (const ff of resp.featureFlags) {
      featureFlagsTable.push([
        ff.name,
        ff.namespace,
        ff.labels.map((l) => joinLabel(l)).join(', ') || '-',
        ff.isEnabled,
        ff.updatedAt || '-',
      ]);
    }
    console.log(featureFlagsTable.toString());
  });

  return command;
};
