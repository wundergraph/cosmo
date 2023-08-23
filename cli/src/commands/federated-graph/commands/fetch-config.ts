import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('fetch-config');
  command.description(
    'Fetches the latest valid router config for a federated graph. The output can be piped to a file.',
  );
  command.argument('<name>', 'The name of the federated graph to fetch.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.getLatestValidRouterConfig(
      {
        graphName: name,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(`${pc.red(`No router config could be fetched for federated graph ${pc.bold(name)}`)}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }

    console.log(resp.config?.toJsonString());
  });

  return command;
};
