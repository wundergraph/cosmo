import { writeFile } from 'node:fs/promises';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command } from 'commander';
import pc from 'picocolors';
import { join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { introspectSubgraph } from '../../../utils.js';
import program from '../../index.js';

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
    });

    if (resp.success !== true) {
      program.error(pc.red('Could not introspect the subgraph.'));
    }

    if (options.out) {
      await writeFile(join(process.cwd(), options.out), resp.sdl ?? '');
    } else {
      console.log(resp.sdl);
    }
  });

  return command;
};
