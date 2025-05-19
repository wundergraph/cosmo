import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../../core/types/types.js';
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
  command.option('--debug', 'Build the binary with debug information');
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

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      // Normalize platform list
      const platforms = normalizePlatforms(options.platform, options.allPlatforms);

      // Start the main build process
      spinner.start('Building plugin...');

      const goModulePath = options.goModulePath;

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

      if (options.generateOnly) {
        spinner.succeed(pc.green('Generated proto and mapping files successfully! ' + `[${formattedTime}]`));
      } else {
        spinner.succeed(pc.green('Plugin built successfully! ' + `[${formattedTime}]`));
      }
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to build plugin: ${error.message}`));
      program.error(`Failed to build plugin: ${error.message}`);
    } finally {
      spinner.stop();
    }
  });

  return command;
};
