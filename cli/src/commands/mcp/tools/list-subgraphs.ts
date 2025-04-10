import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { ToolContext } from './types.js';

export const registerListSubgraphsTool = ({ server, opts }: ToolContext) => {
  server.tool('list_subgraphs', 'List all subgraphs', async () => {
    const resp = await opts.client.platform.getSubgraphs(
      {
        limit: 0,
        offset: 0,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      throw new Error(`Could not fetch subgraphs: ${resp.response?.details || ''}`);
    }

    const out = resp.graphs.map((graph) => {
      return {
        id: graph.id,
        name: graph.name,
        labels: graph.labels,
        routingURL: graph.routingURL,
        lastUpdate: graph.lastUpdatedAt,
      };
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    };
  });
};
