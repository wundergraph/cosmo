import path from 'node:path';
import { Command, program } from 'commander';
import Spinner from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { ProtoOption } from '@wundergraph/protographic';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { renderResultTree } from '../helper.js';
import {
  checkAndInstallTools,
  generateGRPCCode,
  generateProtoAndMapping,
  getGoModulePathProtoOption,
  getLanguage,
  installGoDependencies,
  installTsDependencies,
  validateAndGetGoModulePath,
} from '../toolchain.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('Generate proto and gRPC code for a router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('--skip-tools-installation', 'Skip tool installation', false);
  command.option(
    '--force-tools-installation',
    'Force tools installation regardless of version check or confirmation',
    false,
  );
  command.option('--go-module-path <path>', 'Go module path to use for the plugin');
  command.option('-y, --yes', 'Automatically answer yes to all prompts', false);

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

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation, language, autoConfirmPrompts);
      }

      // Start the generation process
      spinner.start('Generating plugin code...');

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

      // Generate proto and mapping files
      await generateProtoAndMapping(pluginDir, protoOptions, spinner);

      // Generate gRPC code
      await generateGRPCCode(pluginDir, spinner, language);

      switch (language) {
        case 'go': {
          await installGoDependencies(pluginDir, spinner);
          break;
        }
      }

      // Calculate and format elapsed time
      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      renderResultTree(spinner, 'Plugin code generated successfully!', true, pluginName, {
        output: pluginDir,
        time: formattedTime,
        protoOptions: protoOptions.map(({ name, constant }) => `${name}=${constant}`).join(','),
      });

      console.log('');
      console.log(
        `  Now you can modify your implementation in src/main.go, then when you're ready to publish, run ${pc.bold('wgc router plugin publish')}.`,
      );
    } catch (error: any) {
      renderResultTree(spinner, 'Plugin code generation failed!', false, pluginName, {
        output: pluginDir,
        error: error.message,
        protoOptions: protoOptions.map(({ name, constant }) => `${name}=${constant}`).join(','),
      });

      program.error('');
    }
  });

  return command;
};
