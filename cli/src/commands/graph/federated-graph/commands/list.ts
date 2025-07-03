import { writeFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import logSymbols from 'log-symbols';
import { resolve } from 'pathe';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../core/config.js';

type OutputFile = {
  name: string;
  namespace: string;
  labelMatchers: string[];
  routingURL: string;
  isComposable: boolean;
  lastUpdatedAt: string;
  contract?: {
    sourceFederatedGraphId: string;
    excludeTags: string[];
    includeTags: string[];
  };
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all federated graphs in the organization.');
  command.option('-n, --namespace [string]', 'Filter to get graphs in this namespace only.');
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.option('--only-contracts', 'Filter to show contracts only');
  command.action(async (options) => {
    const resp = await opts.client.platform.getFederatedGraphs(
      {
        includeMetrics: false,
        // limit 0 fetches all
        limit: 0,
        offset: 0,
        namespace: options.namespace,
        supportsFederation: true,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch the federated graphs.'));
    }

    const filteredGraphs = [];
    if (options.onlyContracts) {
      filteredGraphs.push(...resp.graphs.filter((g) => !!g.contract));
    } else {
      filteredGraphs.push(...resp.graphs);
    }

    if (filteredGraphs.length === 0) {
      if (options.onlyContracts) {
        console.log('No contracts found');
      } else {
        console.log('No federated graphs found');
      }
      return;
    }

    if (options.out) {
      const output = filteredGraphs.map(
        (g) =>
          ({
            name: g.name,
            namespace: g.namespace,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingURL,
            isComposable: g.isComposable,
            lastUpdatedAt: g.lastUpdatedAt,
            contract: g.contract,
          }) satisfies OutputFile[number],
      );
      await writeFile(resolve(options.out), JSON.stringify(output));
      return;
    }

    if (options.raw) {
      console.warn(pc.yellow('Please use the --json option. The --raw option is deprecated.'));
    }

    if (options.raw || options.json) {
      console.log(JSON.stringify(filteredGraphs));
      return;
    }

    const graphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('LABEL_MATCHERS')),
        pc.bold(pc.white('ROUTING_URL')),
        pc.bold(pc.white('IS_COMPOSABLE')),
        pc.bold(pc.white('UPDATED_AT')),
        pc.bold(pc.white('IS_CONTRACT')),
      ],
      colAligns: ['left', 'left', 'left', 'left', 'center', 'left', 'center'],
      colWidths: [25, 25, 40, 70, 15, 30, 15],
      wordWrap: true,
    });

    for (const graph of filteredGraphs) {
      graphsTable.push([
        graph.name,
        graph.namespace,
        graph.labelMatchers.map((l) => `(${l})`).join(','),
        graph.routingURL,
        graph.isComposable ? logSymbols.success : logSymbols.error,
        graph.lastUpdatedAt,
        graph.contract ? logSymbols.success : logSymbols.error,
      ]);
    }
    console.log(graphsTable.toString());
  });

  return command;
};
