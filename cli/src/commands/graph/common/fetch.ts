import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import { join } from 'pathe';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../core/types/types.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('fetch');
  command.description(`Fetches the latest valid SDL of a ${graphType}. The output can be piped to a file.`);
  command.argument('<name>', `The name of the ${graphType} to fetch.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.getFederatedGraphSDLByName(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.ERR_NOT_FOUND) {
      console.log(`${pc.red(`No valid composition could be fetched for ${graphType} ${pc.bold(name)}`)}`);
      console.log(`Please check the name and the composition status of the ${graphType} in the Studio.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }

    if (options.out) {
      await writeFile(join(process.cwd(), options.out), resp.sdl ?? '');
    } else {
      console.log(resp.sdl);
    }
  });

  return command;
};
