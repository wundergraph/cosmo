import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command } from 'commander';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { introspectSubgraph } from '../../../utils.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const introspectSubgraphCmd = new Command('introspect');
  introspectSubgraphCmd.description('Introspects a subgraph.');
  introspectSubgraphCmd.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your subgraph. This is the url that the subgraph will be accessible at.',
  );
  introspectSubgraphCmd.option(
    '--header [headers...]',
    'The headers to apply when the subgraph is introspected. This is used for authentication and authorization.The headers are passed in the format <key>=<value> <key>=<value>.Use quotes if there exists space in the key/value.',
  );
  introspectSubgraphCmd.action(async (options) => {
    const resp = await introspectSubgraph({
      subgraphURL: options.routingUrl,
      additionalHeaders:
        options.header?.map((label: string) => {
          const { key, value } = splitLabel(label);
          return {
            key,
            value,
          };
        }) || [],
    });

    if (resp.success === true) {
      console.log(resp.sdl);
    } else {
      program.error(pc.red('Could not introspect the subgraph.'));
    }
  });

  return introspectSubgraphCmd;
};
