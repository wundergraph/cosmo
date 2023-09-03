import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import Table from 'cli-table';
import logSymbols from 'log-symbols';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const listFederatedGraphs = new Command('list');
  listFederatedGraphs.description('Fetches a list of federated graphs.');
  listFederatedGraphs.action(async () => {
    const resp = await opts.client.platform.getFederatedGraphs(
      {
        includeMetrics: false,
        // limit 0 fetches all
        limit: 0,
        offset: 0,
      },
      {
        headers: baseHeaders,
      },
    );

    const graphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('LABEL_MATCHERS')),
        pc.bold(pc.white('ROUTING_URL')),
        pc.bold(pc.white('IS_COMPOSABLE')),
      ],
      colAligns: ['left', 'left', 'left', 'middle'],
      colWidths: [30, 40, 60, 15],
    });

    if (resp.response?.code === EnumStatusCode.OK) {
      if (resp.graphs.length > 0) {
        for (const graph of resp.graphs) {
          graphsTable.push([
            graph.name,
            graph.labelMatchers.join(','),
            graph.routingURL,
            graph.isComposable ? logSymbols.success : logSymbols.error,
          ]);
        }
        console.log(graphsTable.toString());
      } else {
        console.log('No federated graphs found');
      }
    } else {
      console.log(`${pc.red('Could not fetch the list of federated graphs.')}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return listFederatedGraphs;
};
