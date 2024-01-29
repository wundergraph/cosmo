import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import jwtDecode from 'jwt-decode';
import pc from 'picocolors';
import { join } from 'pathe';
import { baseHeaders, config } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { GraphToken } from '../../auth/utils.js';

export const handleOutput = async (out: string | undefined, config: string) => {
  if (out) {
    await writeFile(join(process.cwd(), out), config ?? '');
  } else {
    console.log(config);
  }
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('fetch');
  command.description(
    'Fetches the latest valid router config for a federated graph. The output can be piped to a file.',
  );
  command.argument('<name>', 'The name of the federated graph to fetch.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option('-o, --out [string]', 'Destination file for the router config.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.getFederatedGraphByName(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(`${pc.red(`Federated graph ${pc.bold(name)} not found.`)}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }

    let decoded: GraphToken;

    try {
      decoded = jwtDecode<GraphToken>(resp.graphToken);
    } catch {
      program.error('Could not fetch the router config. Please try again');
    }

    const requestBody = JSON.stringify({
      Version: '',
    });

    const headers = new Headers();
    headers.append('Content-Type', 'application/json; charset=UTF-8');
    headers.append('Authorization', 'Bearer ' + resp.graphToken);
    headers.append('Accept-Encoding', 'gzip');

    const url = new URL(
      `/${decoded.organization_id}/${decoded.federated_graph_id}/routerconfigs/latest.json`,
      config.cdnURL,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
    });
    if (response.status !== 200) {
      const latestConfigResp = await opts.client.platform.getLatestValidRouterConfig(
        {
          graphName: name,
          namespace: options.namespace,
        },
        {
          headers: baseHeaders,
        },
      );

      if (latestConfigResp.response?.code !== EnumStatusCode.OK) {
        console.log(`${pc.red(`No router config could be fetched for federated graph ${pc.bold(name)}`)}`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
      await handleOutput(options.out, latestConfigResp.config?.toJsonString() ?? '');

      process.exit(0);
    }

    const body = await response.json();
    await handleOutput(options.out, JSON.stringify(body));
  });

  return command;
};
