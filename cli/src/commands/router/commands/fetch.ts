import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import jwtDecode from 'jwt-decode';
import pc from 'picocolors';
import { join } from 'pathe';
import { baseHeaders, config } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { GraphToken } from '../../auth/utils.js';
import { makeSignature, safeCompare } from '../../../core/signature.js';

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
  command.option(
    '--graph-sign-key [string]',
    'The signature key to verify the downloaded router config. If not provided, the router config will not be verified.',
  );
  command.action(async (name, options) => {
    const resp = await opts.client.platform.generateRouterToken(
      {
        fedGraphName: name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(`${pc.red(`Could not fetch the router config for the federated graph ${pc.bold(name)}`)}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }

    let decoded: GraphToken;

    try {
      decoded = jwtDecode<GraphToken>(resp.token);
    } catch {
      program.error('Could not fetch the router config. Please try again');
    }

    const requestBody = JSON.stringify({
      Version: '',
    });

    const headers = new Headers();
    headers.append('Content-Type', 'application/json; charset=UTF-8');
    headers.append('Authorization', 'Bearer ' + resp.token);
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

    const body = await response.text();
    const signature = response.headers.get('X-Signature-SHA256');

    if (!signature) {
      console.log(pc.red('The router config response does not contain a signature but a signature key was provided.'));
      process.exit(1);
    }

    if (options.graphSignKey) {
      const hash = await makeSignature(body, options.graphSignKey);

      if (!safeCompare(hash, signature)) {
        console.log(pc.red('The signature of the router config does not match the provided signature key.'));
        process.exit(1);
      }

      if (options.out) {
        await handleOutput(options.out, body);

        console.log(pc.green('The signature of the router config matches the local computed signature.'));
        console.log(pc.green(`The router config has been written to ${pc.bold(options.out)}`));

        return;
      }
    }

    await handleOutput(options.out, body);
  });

  return command;
};
