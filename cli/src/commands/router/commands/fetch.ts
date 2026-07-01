import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { resolve, join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import {
  fetchRouterConfig,
  mapperFile,
  featureFlagsDir,
  getRouterConfigOutputFile,
  latestFile,
  writeFeatureFlagConfigToFile,
} from '../utils.js';
import type { FetchRouterConfigResult } from '../types/types.js';

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

const handleOutput = (out: string | undefined, graphSignKey: string | undefined, config: FetchRouterConfigResult) => {
  return config.splitConfigLoading
    ? handleSplitRouterConfig(out, !!graphSignKey, config)
    : handleEmbeddedRouterConfig(out, !!graphSignKey, config);
};

async function handleSplitRouterConfig(
  out: string | undefined,
  graphSignKey: boolean,
  config: FetchRouterConfigResult,
) {
  let outputDir = out ? resolve(out) : out;
  if (!outputDir) {
    outputDir = resolve('router-config-output');
  }

  if (!existsSync(outputDir)) {
    await mkdir(outputDir);
  }

  const entries = await readdir(outputDir);
  if (entries.length > 0) {
    console.log(
      pc.red(
        `Split-config flag enabled; output directory "${outputDir}" is not empty. Please provide an empty directory path.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  await writeFile(join(outputDir, latestFile), config.routerConfig);
  if (config.mapper) {
    await writeFile(join(outputDir, mapperFile), JSON.stringify(config.mapper));
  }

  if (config.featureFlags && config.featureFlags.size > 0) {
    const ffDir = join(outputDir, featureFlagsDir);
    try {
      await mkdir(ffDir);
    } catch {
      console.log(
        pc.red(
          `Split-config flag enabled; output directory "${ffDir}" already exists. Please provide an empty root directory path.`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    for (const [featureFlagName, featureFlagRouterConfig] of config.featureFlags) {
      await writeFeatureFlagConfigToFile(ffDir, featureFlagName, featureFlagRouterConfig);
    }
  }

  if (graphSignKey) {
    console.log(pc.green('The signature of the router config matches the local computed signature.'));
  }

  console.log(pc.green(`The router configs has been written to ${pc.bold(outputDir)}`));
}

async function handleEmbeddedRouterConfig(
  out: string | undefined,
  graphSignKey: boolean,
  config: FetchRouterConfigResult,
) {
  if (out) {
    const output = await getRouterConfigOutputFile(out);
    await writeFile(output, config.routerConfig);
    if (graphSignKey) {
      console.log(pc.green('The signature of the router config matches the local computed signature.'));
    }

    console.log(pc.green(`The router config has been written to ${pc.bold(out)}`));
  } else {
    console.log(config.routerConfig);
  }
}
