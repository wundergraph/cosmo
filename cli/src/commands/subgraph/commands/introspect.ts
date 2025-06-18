import { writeFile } from 'node:fs/promises';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { join, resolve } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { introspectSubgraph } from '../../../utils.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('introspect');
  command.description('Introspects a subgraph.');
  command.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your subgraph. This is the url that the subgraph will be accessible at.',
  );
  command.option(
    '--header [headers...]',
    'The headers to apply when the subgraph is introspected. This is used for authentication and authorization.The headers are passed in the format <key>=<value> <key>=<value>.Use quotes if there exists space in the key/value.',
  );
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.option('--use-raw-introspection', 'This will use the standard introspection query.');
  command.action(async (options) => {
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
      rawIntrospection: options.useRawIntrospection,
    });

    if (resp.success !== true) {
      program.error(pc.red('Could not introspect the subgraph.'));
    }

    if (options.out) {
      await writeFile(resolve(options.out), resp.sdl ?? '');
    } else {
      console.log(resp.sdl);
    }
  });

  return command;
};
