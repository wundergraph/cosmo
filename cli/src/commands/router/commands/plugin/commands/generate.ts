import path from 'node:path';
import { Command, program } from 'commander';
import Spinner from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { renderResultTree } from '../helper.js';
import {
  checkAndInstallTools,
  generateGRPCCode,
  generateProtoAndMapping,
  installGoDependencies,
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

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      // Start the generation process
      spinner.start('Generating plugin code...');

      // Generate proto and mapping files
      await generateProtoAndMapping(pluginDir, goModulePath, spinner);

      // Generate gRPC code
      await generateGRPCCode(pluginDir, spinner);

      // Install Go dependencies
      await installGoDependencies(pluginDir, spinner);

      // Calculate and format elapsed time
      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      renderResultTree(spinner, 'Plugin code generated successfully!', true, pluginName, {
        output: pluginDir,
        'go module': goModulePath,
        time: formattedTime,
      });

      console.log('');
      console.log(
        `  Now you can modify your implementation in src/main.go, then when you're ready to publish, run ${pc.bold('wgc router plugin publish')}.`,
      );
    } catch (error: any) {
      renderResultTree(spinner, 'Plugin code generation failed!', false, pluginName, {
        output: pluginDir,
        'go module': goModulePath,
        error: error.message,
      });

      program.error('');
    }
  });

  return command;
};
