import { Command } from 'commander';
import Table from 'cli-table3';
import { createOutput, prefersJson } from '@wundergraph/wgc-plugin-sdk';
import { listPlugins, PluginListing } from '../../../core/plugins/registry.js';
import { PluginCommandOptions } from '../index.js';

const describeSource = (plugin: PluginListing): string => {
  if (plugin.source === 'available') {
    return `not installed (wgc plugins install ${plugin.name})`;
  }
  return plugin.active ? plugin.source : `${plugin.source}, shadowed by the workspace package`;
};

export default (opts: PluginCommandOptions) => {
  const command = new Command('list');
  command.description('Lists workspace, installed and known-but-not-installed plugins.');
  command.option('--json', 'Prints the result as JSON.');
  command.action((options: { json?: boolean }) => {
    const output = createOutput({
      json: options.json === true || prefersJson(opts.caller),
      stdout: opts.stdout,
      stderr: opts.stderr,
    });

    output.result({ plugins: listPlugins(opts.environment) }, ({ plugins }) => {
      const table = new Table({ head: ['NAME', 'PACKAGE', 'VERSION', 'SOURCE'] });
      for (const plugin of plugins) {
        table.push([plugin.name, plugin.packageName, plugin.version ?? '-', describeSource(plugin)]);
      }
      return table.toString();
    });
  });
  return command;
};
