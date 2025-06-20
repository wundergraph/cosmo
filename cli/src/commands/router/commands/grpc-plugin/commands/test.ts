import path from 'node:path';
import os from 'node:os';
import { Command } from 'commander';
import { resolve } from 'pathe';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { checkAndInstallTools, installGoDependencies, runGoTests } from '../toolchain.js';
import { renderResultTree } from '../helper.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('test');
  command.description('Run tests for a gRPC router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('--skip-tools-installation', 'Skip tool installation', false);
  command.option(
    '--force-tools-installation',
    'Force tools installation regardless of version check or confirmation',
    false,
  );
  command.action(async (directory, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(directory);
    const spinner = Spinner({ text: 'Running tests...' });
    const pluginName = path.basename(pluginDir);

    try {
      spinner.start();

      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      spinner.text = 'Installing Go dependencies...';

      await installGoDependencies(pluginDir, spinner);

      const srcDir = resolve(pluginDir, 'src');

      spinner.text = 'Running tests...';

      try {
        const { failed } = await runGoTests(srcDir, spinner, false);

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTimeMs = endTime - startTime;
        const formattedTime =
          elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

        // Common details for both success and failure
        const details = {
          source: srcDir,
          env: `${os.platform()} ${os.arch()}`,
          time: formattedTime,
        };

        const title = failed ? 'Tests failed!' : 'Tests completed successfully!';
        renderResultTree(spinner, title, !failed, pluginName, details);
      } catch (error: any) {
        renderResultTree(spinner, 'Tests failed!', false, pluginName, {
          source: srcDir,
          env: `${os.platform()} ${os.arch()}`,
          error: error.message,
        });
      }
    } catch (error: any) {
      renderResultTree(spinner, 'Failed to run tests!', false, pluginName, {
        env: `${os.platform()} ${os.arch()}`,
        error: error.message,
      });
    } finally {
      spinner.stop();
    }
  });

  return command;
};
