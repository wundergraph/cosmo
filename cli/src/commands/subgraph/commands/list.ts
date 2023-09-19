import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command } from 'commander';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const listSubgraphs = new Command('list');
  listSubgraphs.description('Lists subgraphs.');
  listSubgraphs.action(async () => {
    const resp = await opts.client.platform.getSubgraphs(
      {
        // limit 0 fetches all
        limit: 0,
        offset: 0,
      },
      {
        headers: baseHeaders,
      },
    );

    const graphsTable = new Table({
      head: [pc.bold(pc.white('NAME')), pc.bold(pc.white('LABELS')), pc.bold(pc.white('ROUTING_URL'))],
      colWidths: [15, 30, 60],
      wordWrap: true,
    });

    if (resp.response?.code === EnumStatusCode.OK) {
      if (resp.graphs.length > 0) {
        for (const graph of resp.graphs) {
          graphsTable.push([
            graph.name,
            graph.labels.map(({ key, value }) => `${key}=${value}`).join(', '),
            graph.routingURL,
          ]);
        }
        console.log(graphsTable.toString());
      } else {
        console.log('No subgraphs found');
      }
    } else {
      program.error(pc.red('Could not fetch the subgraphs.'));
    }
  });

  return listSubgraphs;
};
