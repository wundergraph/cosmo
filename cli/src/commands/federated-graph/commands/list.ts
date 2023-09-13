import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import Table from 'cli-table3';
import logSymbols from 'log-symbols';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const listFederatedGraphs = new Command('list');
  listFederatedGraphs.description('Lists federated graphs.');
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
      colAligns: ['left', 'left', 'left', 'center'],
      colWidths: [25, 40, 70, 15],
      wordWrap: true,
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
      program.error(pc.red('Could not fetch the federated graphs.'));
    }
  });

  return listFederatedGraphs;
};
