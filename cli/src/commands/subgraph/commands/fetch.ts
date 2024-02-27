import { writeFile } from 'node:fs/promises';
import { Response } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { join } from 'pathe';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('fetch');
  command.description(
    'Fetches the latest published SDL of a subgraph. If the federated graph is specified, the latest successfully composed version of the subgraph will be fetched.',
  );
  command.argument('<name>', 'The name of the subgraph to fetch.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option(
    '-g --graph-name [string]',
    'The name of the federated graph to fetch the latest valid subgraph SDL from.',
  );
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.action(async (name, options) => {
    let subgraphSDL = '';
    let response: Response | undefined;

    if (options.graphName) {
      const res = await opts.client.platform.getSubgraphSDLFromLatestComposition(
        {
          name,
          fedGraphName: options.graphName,
          namespace: options.namespace,
        },
        {
          headers: baseHeaders,
        },
      );

      subgraphSDL = res.sdl ?? '';
      response = res.response;
    } else {
      const resp = await opts.client.platform.getLatestSubgraphSDL(
        {
          name,
          namespace: options.namespace,
        },
        {
          headers: baseHeaders,
        },
      );

      subgraphSDL = resp.sdl ?? '';
      response = resp.response;
    }

    if (response?.code === EnumStatusCode.ERR_FREE_TRIAL_EXPIRED) {
      program.error(response.details || 'Free trial has concluded. Please talk to sales to upgrade your plan.');
    }

    if (response?.code === EnumStatusCode.ERR_NOT_FOUND) {
      console.log(`${pc.red(`No valid SDL could be fetched for subgraph ${pc.bold(name)}`)}`);
      if (response?.details) {
        console.log(pc.red(pc.bold(response?.details)));
      }
      process.exit(1);
    }

    if (options.out) {
      await writeFile(join(process.cwd(), options.out), subgraphSDL ?? '');
    } else {
      console.log(subgraphSDL);
    }
  });

  return command;
};
