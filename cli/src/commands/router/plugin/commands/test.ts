import { Command } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { checkAndInstallTools, runGoTests } from '../toolchain.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('test');
  command.description('Run tests for a gRPC router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('-l, --language <language>', 'Programming language of the plugin', 'go');
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

    try {
      spinner.start();

      if (options.language.toLowerCase() !== 'go') {
        spinner.warn(pc.yellow(`Language '${options.language}' is not supported yet. Using 'go' instead.`));
        options.language = 'go';
      }

      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      const srcDir = resolve(pluginDir, 'src');

      spinner.text = 'Running tests...';

      try {
        const { failed } = await runGoTests(srcDir, spinner);

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTimeMs = endTime - startTime;
        const formattedTime =
          elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

        if (failed) {
          spinner.fail(pc.red(`Failed to run tests!`));
        } else {
          spinner.succeed(pc.green(`Tests completed successfully! [${formattedTime}]`));
        }
      } catch (error: any) {
        spinner.fail(pc.red(`Tests failed: ${error.message}`));
      }
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to run tests: ${error.message}`));
    } finally {
      spinner.stop();
    }
  });

  return command;
};
