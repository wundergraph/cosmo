import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import logSymbols from 'log-symbols';
import { join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';
import program from '../../index.js';

type OutputFile = {
  name: string;
  namespace: string;
  labelMatchers: string[];
  routingURL: string;
  isComposable: boolean;
  lastUpdatedAt: string;
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all federated graphs in the organization.');
  command.option('-n, --namespace [string]', 'Filter to get graphs in this namespace only.');
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.action(async (options) => {
    const resp = await opts.client.platform.getFederatedGraphs(
      {
        includeMetrics: false,
        // limit 0 fetches all
        limit: 0,
        offset: 0,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch the federated graphs.'));
    }

    if (resp.graphs.length === 0) {
      console.log('No federated graphs found');
      process.exit(0);
    }

    if (options.out) {
      const output = resp.graphs.map(
        (g) =>
          ({
            name: g.name,
            namespace: g.namespace,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingURL,
            isComposable: g.isComposable,
            lastUpdatedAt: g.lastUpdatedAt,
          }) as OutputFile[number],
      );
      await writeFile(join(process.cwd(), options.out), JSON.stringify(output));
      process.exit(0);
    }

    if (options.raw) {
      console.log(resp.graphs);
      process.exit(0);
    }

    const graphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('LABEL_MATCHERS')),
        pc.bold(pc.white('ROUTING_URL')),
        pc.bold(pc.white('IS_COMPOSABLE')),
        pc.bold(pc.white('UPDATED_AT')),
      ],
      colAligns: ['left', 'left', 'left', 'center'],
      colWidths: [25, 25, 40, 70, 15, 30],
      wordWrap: true,
    });

    for (const graph of resp.graphs) {
      graphsTable.push([
        graph.name,
        graph.namespace,
        graph.labelMatchers.map((l) => `(${l})`).join(','),
        graph.routingURL,
        graph.isComposable ? logSymbols.success : logSymbols.error,
        graph.lastUpdatedAt,
      ]);
    }
    console.log(graphsTable.toString());
  });

  return command;
};
