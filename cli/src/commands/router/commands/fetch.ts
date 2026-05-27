import { writeFile, mkdir } from 'node:fs/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { resolve, join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchRouterConfig, type FetchRouterConfigResult } from '../utils.js';

export const handleOutput = async (
  out: string | undefined,
  graphSignKey: string | undefined,
  config: FetchRouterConfigResult,
) => {
  if (out) {
    if (config.splitConfigLoading) {
      let directory = resolve(out);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'latest.json'), config.routerConfig);
      if (config.mapper) {
        await writeFile(join(directory, 'mapper.json'), JSON.stringify(config.mapper));
      }

      if (config.featureFlags && config.featureFlags.size > 0) {
        directory = resolve(directory, 'feature-flags');
        await mkdir(directory, { recursive: true });

        for (const [featureFlagName, featureFlagRouterConfig] of config.featureFlags) {
          await writeFile(resolve(directory, `${featureFlagName}.json`), featureFlagRouterConfig);
        }
      }
    } else {
      await writeFile(resolve(out), config.routerConfig);
    }

    if (graphSignKey) {
      console.log(pc.green('The signature of the router config matches the local computed signature.'));
    }

    console.log(
      pc.green(`The router config${config.splitConfigLoading ? 's' : ''} has been written to ${pc.bold(out)}`),
    );
  } else {
    console.log(config.routerConfig);
  }
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('fetch');
  command.description(
    'Fetches the latest valid router config for a federated graph or monograph. The output can be piped to a file.',
  );
  command.argument('<name>', 'The name of the federated graph or monograph to fetch.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.option('-o, --out [string]', 'Destination file for the router config.');
  command.option(
    '--graph-sign-key [string]',
    'The signature key to verify the downloaded router config. If not provided, the router config will not be verified.',
  );
  command.action(async (name, options) => {
    try {
      const result = await fetchRouterConfig({
        client: opts.client,
        name,
        namespace: options.namespace,
        graphSignKey: options.graphSignKey,
      });

      await handleOutput(options.out, options.graphSignKey, result);
    } catch (err) {
      if (err instanceof Error) {
        console.error(err.message);
      }

      process.exitCode = 1;
    }
  });

  return command;
};
