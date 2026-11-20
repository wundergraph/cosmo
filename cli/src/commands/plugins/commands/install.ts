import { Command } from 'commander';
import { createOutput, errorMessage, prefersJson } from '@wundergraph/wgc-plugin-sdk';
import { installPlugin } from '../../../core/plugins/manage.js';
import { PluginCommandOptions } from '../index.js';

export default (opts: PluginCommandOptions) => {
  const command = new Command('install');
  command.description(
    'Installs a plugin by name (hub, forge), npm package or local directory. With WGC_PLUGIN_REGISTRY_URL set, a name installs <url>/wgc-plugin-<name>.tgz.',
  );
  command.argument('<plugin>', 'A known plugin name, an npm package spec, or a path to a plugin package.');
  command.option('--json', 'Prints the result as JSON.');
  command.action(async (spec: string, options: { json?: boolean }) => {
    const output = createOutput({
      json: options.json === true || prefersJson(opts.caller),
      stdout: opts.stdout,
      stderr: opts.stderr,
    });
    const program = command.parent?.parent;
    const reservedNames = program ? program.commands.map((builtIn) => builtIn.name()) : [];

    const installed = await installPlugin({
      environment: opts.environment,
      npm: opts.npm,
      progress: (event) => output.progress(event),
      spec,
      reservedNames,
    });
    if (!installed.success) {
      output.fail({ message: errorMessage(installed), input: spec });
      return;
    }

    output.result(
      { plugin: installed.data },
      ({ plugin }) => `Installed ${plugin.packageName}@${plugin.version}. Run "wgc ${plugin.name} --help" to start.`,
    );
  });
  return command;
};
