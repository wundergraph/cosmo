import path from 'node:path';
import os from 'node:os';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { renderResultTree } from '../helper.js';
import {
  buildBinaries,
  checkAndInstallTools,
  generateGRPCCode,
  generateProtoAndMapping,
  HOST_PLATFORM,
  installGoDependencies,
  normalizePlatforms,
} from '../toolchain.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('build');
  command.description('Build a gRPC router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('--generate-only', 'Generate only the proto and mapping files, do not compile the plugin');
  command.option('--debug', 'Build the binary with debug information', false);
  command.option('--platform [platforms...]', 'Platform-architecture combinations (e.g., darwin-arm64 linux-amd64)', [
    HOST_PLATFORM,
  ]);
  command.option('--all-platforms', 'Build for all supported platforms', false);
  command.option('--skip-tools-installation', 'Skip tool installation', false);
  command.option(
    '--force-tools-installation',
    'Force tools installation regardless of version check or confirmation',
    false,
  );
  command.option(
    '--go-module-path <path>',
    'Go module path to use for the plugin',
    'github.com/wundergraph/cosmo/plugin',
  );

  command.action(async (directory, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(directory);
    const spinner = Spinner();
    const pluginName = path.basename(pluginDir);
    const goModulePath = options.goModulePath;
    let platforms: string[] = [];

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      // Normalize platform list
      platforms = normalizePlatforms(options.platform, options.allPlatforms);

      // Start the main build process
      spinner.start('Building plugin...');

      // Generate proto and mapping files
      await generateProtoAndMapping(pluginDir, goModulePath, spinner);

      // Generate gRPC code
      await generateGRPCCode(pluginDir, spinner);

      if (!options.generateOnly) {
        // Install Go dependencies
        await installGoDependencies(pluginDir, spinner);

        // Build binaries for all platforms
        await buildBinaries(pluginDir, platforms, options.debug, spinner);
      }

      // Calculate and format elapsed time
      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      renderResultTree(spinner, 'Plugin built successfully!', true, pluginName, {
        output: pluginDir,
        'go module': goModulePath,
        platforms: platforms.join(', '),
        env: `${os.platform()} ${os.arch()}`,
        build: options.debug ? 'debug' : 'release',
        type: options.generateOnly ? 'generate-only' : 'full',
        time: formattedTime,
      });
    } catch (error: any) {
      renderResultTree(spinner, 'Plugin build failed!', false, pluginName, {
        output: pluginDir,
        'go module': goModulePath,
        platforms: platforms.join(', '),
        env: `${os.platform()} ${os.arch()}`,
        build: options.debug ? 'debug' : 'release',
        type: options.generateOnly ? 'generate-only' : 'full',
        error: error.message,
      });

      program.error('');
    }
  });

  return command;
};
