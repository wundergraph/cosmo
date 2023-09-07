import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const introspectSubgraph = new Command('introspect');
  introspectSubgraph.description('Introspects a subgraph.');
  introspectSubgraph.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your subgraph. This is the url that the subgraph will be accessible at.',
  );
  introspectSubgraph.option(
    '--header [headers...]',
    'The headers to apply when the subgraph is introspected. This is used for authentication and authorization.The headers are passed in the format <key>=<value> <key>=<value>.Use quotes if there exists space in the key/value.',
  );
  introspectSubgraph.action(async (options) => {
    const resp = await opts.client.platform.introspectSubgraph(
      {
        url: options.routingUrl,
        headers: options.header?.map((label: string) => {
          const { key, value } = splitLabel(label);
          return {
            key,
            value,
          };
        }),
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log('SDL of the subgraph:-\n');
      console.log(resp.sdl);
    } else {
      program.error(pc.red('Could not introspect the subgraph.'));
    }
  });

  return introspectSubgraph;
};
