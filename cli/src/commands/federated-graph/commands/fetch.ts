import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const fetchFederatedGraph = new Command('fetch');
  fetchFederatedGraph.description(
    'Fetches the latest valid SDL of a federated graph. The output can be piped to a file.',
  );
  fetchFederatedGraph.argument('<name>', 'The name of the federated graph to fetch.');
  fetchFederatedGraph.action(async (name, options) => {
    const resp = await opts.client.platform.getFederatedGraphSDLByName(
      {
        name,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.ERR_NOT_FOUND) {
      console.log(`${pc.red(`No valid composition could be fetched for federated graph ${pc.bold(name)}`)}`);
      console.log('Please check the name and the composition status of the federated graph in the Studio.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }

    console.log(resp.sdl);
  });

  return fetchFederatedGraph;
};
