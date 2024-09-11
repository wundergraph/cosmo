import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { resolve } from 'pathe';
import logSymbols from 'log-symbols';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../core/config.js';
import program from '../../../index.js';

type OutputFile = {
  name: string;
  namespace: string;
  routingURL: string;
  lastUpdatedAt: string;
  contract?: {
    sourceFederatedGraphId: string;
    excludeTags: string[];
  };
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all monographs in the organization.');
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
        supportsFederation: false,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch the monographs.'));
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
        console.log('No monographs found');
      }
      process.exit(0);
    }

    if (options.out) {
      const output = filteredGraphs.map(
        (g) =>
          ({
            name: g.name,
            namespace: g.namespace,
            routingURL: g.routingURL,
            lastUpdatedAt: g.lastUpdatedAt,
            contract: g.contract,
          }) satisfies OutputFile[number],
      );
      await writeFile(resolve(options.out), JSON.stringify(output));
      process.exit(0);
    }

    if (options.raw) {
      console.log(pc.yellow('Please use the --json option. The --raw option is deprecated.'));
    }

    if (options.raw || options.json) {
      console.log(filteredGraphs);
      process.exit(0);
    }

    const graphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('ROUTING_URL')),
        pc.bold(pc.white('UPDATED_AT')),
        pc.bold(pc.white('IS_CONTRACT')),
      ],
      colAligns: ['left', 'left', 'left', 'left', 'center'],
      colWidths: [25, 25, 70, 30, 15],
      wordWrap: true,
    });

    for (const graph of filteredGraphs) {
      graphsTable.push([
        graph.name,
        graph.namespace,
        graph.routingURL,
        graph.lastUpdatedAt,
        graph.contract ? logSymbols.success : logSymbols.error,
      ]);
    }
    console.log(graphsTable.toString());
  });

  return command;
};
