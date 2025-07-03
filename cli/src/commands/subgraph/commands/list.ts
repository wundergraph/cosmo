import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { join, resolve } from 'pathe';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

type OutputFile = {
  name: string;
  labels: string[];
  routingURL: string;
  lastUpdatedAt: string;
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists subgraphs from a given namespace.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraphs.');
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.action(async (options) => {
    const resp = await opts.client.platform.getSubgraphs(
      {
        namespace: options.namespace,
        // limit 0 fetches all
        limit: 0,
        offset: 0,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch subgraphs.'));
    }

    if (resp.graphs.length === 0) {
      console.log('No subgraphs found');
      return;
    }

    if (options.out) {
      const output = resp.graphs.map(
        (g) =>
          ({
            name: g.name,
            labels: g.labels.map((l) => joinLabel(l)),
            routingURL: g.routingURL,
            lastUpdatedAt: g.lastUpdatedAt,
          }) as OutputFile[number],
      );
      await writeFile(resolve(options.out), JSON.stringify(output));
      return;
    }

    if (options.raw) {
      console.warn(pc.yellow('Please use the --json option. The --raw option is deprecated.'));
    }

    if (options.raw || options.json) {
      console.log(JSON.stringify(resp.graphs));
      return;
    }

    const graphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('LABELS')),
        pc.bold(pc.white('ROUTING_URL')),
        pc.bold(pc.white('UPDATED_AT')),
      ],
      colWidths: [15, 20, 30, 60, 30],
      wordWrap: true,
    });

    for (const graph of resp.graphs) {
      graphsTable.push([
        graph.name,
        graph.namespace,
        graph.labels.map(({ key, value }) => `${key}=${value}`).join(', '),
        graph.routingURL,
        graph.lastUpdatedAt,
      ]);
    }
    console.log(graphsTable.toString());
  });

  return command;
};
