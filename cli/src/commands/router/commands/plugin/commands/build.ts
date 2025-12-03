import path from 'node:path';
import os from 'node:os';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import Spinner from 'ora';
import { ProtoOption } from '@wundergraph/protographic';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { renderResultTree } from '../helper.js';
import {
  buildGoBinaries,
  checkAndInstallTools,
  generateGRPCCode,
  generateProtoAndMapping,
  getLanguage,
  installGoDependencies,
  installTsDependencies,
  typeCheckTs,
  buildTsBinaries,
  normalizePlatforms,
  validateAndGetGoModulePath,
  getGoModulePathProtoOption,
} from '../toolchain.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('build');
  command.description('Build a gRPC router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('--generate-only', 'Generate only the proto and mapping files, do not compile the plugin');
  command.option('--debug', 'Build the binary with debug information', false);
  command.option(
    '--platform [platforms...]',
    'Platform-architecture combinations (e.g., darwin-arm64 linux-amd64)',
    [],
  );
  command.option('--all-platforms', 'Build for all supported platforms', false);

  command.option('--skip-tools-installation', 'Skip tool installation', false);
  command.option(
    '--force-tools-installation',
    'Force tools installation regardless of version check or confirmation',
    false,
  );
  command.option('-y, --yes', 'Automatically answer yes to all prompts', false);

  command.option('--go-module-path <path>', 'Go module path to use for the plugin');

  command.action(async (directory, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(directory);
    const spinner = Spinner();
    const pluginName = path.basename(pluginDir);
    const autoConfirmPrompts: boolean = options.yes;

    const language = getLanguage(pluginDir);
    if (!language) {
      renderResultTree(spinner, 'Plugin language detection failed!', false, pluginName, {
        output: pluginDir,
      });
      program.error('');
    }

    const protoOptions: ProtoOption[] = [];
    let platforms: string[] = [];

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation, language, autoConfirmPrompts);
      }

      // Start the main build process
      spinner.start('Building plugin...');

      const goModulePath = validateAndGetGoModulePath(language, options.goModulePath);

      switch (language) {
        case 'ts': {
          await installTsDependencies(pluginDir, spinner);
          break;
        }
        case 'go': {
          protoOptions.push(getGoModulePathProtoOption(goModulePath!));
          break;
        }
      }

      // Normalize platform list
      platforms = normalizePlatforms(options.platform, options.allPlatforms, language);

      // Generate proto and mapping files
      await generateProtoAndMapping(pluginDir, protoOptions, spinner);

      // Generate gRPC code
      await generateGRPCCode(pluginDir, spinner, language);

      if (!options.generateOnly) {
        switch (language) {
          case 'go': {
            await installGoDependencies(pluginDir, spinner);
            await buildGoBinaries(pluginDir, platforms, options.debug, spinner);
            break;
          }
          case 'ts': {
            await typeCheckTs(pluginDir, spinner);
            await buildTsBinaries(pluginDir, platforms, options.debug, spinner);
            break;
          }
        }
      }

      // Calculate and format elapsed time
      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      renderResultTree(spinner, 'Plugin built successfully!', true, pluginName, {
        output: pluginDir,
        platforms: platforms.join(', '),
        env: `${os.platform()} ${os.arch()}`,
        build: options.debug ? 'debug' : 'release',
        type: options.generateOnly ? 'generate-only' : 'full',
        time: formattedTime,
        protoOptions: protoOptions.map(({ name, constant }) => `${name}=${constant}`).join(','),
      });
    } catch (error: any) {
      const details: Record<string, any> = {
        output: pluginDir,
        platforms: platforms.join(', '),
        env: `${os.platform()} ${os.arch()}`,
        build: options.debug ? 'debug' : 'release',
        type: options.generateOnly ? 'generate-only' : 'full',
        error: error.message,
        protoOptions: protoOptions.map(({ name, constant }) => `${name}=${constant}`).join(','),
      };
      renderResultTree(spinner, 'Plugin build failed!', false, pluginName, details);
      program.error('');
    }
  });

  return command;
};
