import { Command } from 'commander';
import { createOutput, errorMessage, prefersJson } from '@wundergraph/wgc-plugin-sdk';
import { removePlugin } from '../../../core/plugins/manage.js';
import { PluginCommandOptions } from '../index.js';

export default (opts: PluginCommandOptions) => {
  const command = new Command('remove');
  command.description('Removes an installed plugin.');
  command.argument('<plugin>', 'The plugin command name or its npm package name.');
  command.option('--json', 'Prints the result as JSON.');
  command.action(async (name: string, options: { json?: boolean }) => {
    const output = createOutput({
      json: options.json === true || prefersJson(opts.caller),
      stdout: opts.stdout,
      stderr: opts.stderr,
    });

    const removed = await removePlugin({
      environment: opts.environment,
      npm: opts.npm,
      progress: (event) => output.progress(event),
      name,
    });
    if (!removed.success) {
      output.fail({
        message: errorMessage(removed),
        input: name,
        remediation: 'Run "wgc plugins list" to see installed plugins.',
      });
      return;
    }

    output.result({ plugin: removed.data }, ({ plugin }) => `Removed ${plugin.packageName}.`);
  });
  return command;
};
