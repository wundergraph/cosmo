import type { Command } from 'commander';
import { createPluginContext, detectCaller, errorMessage, readOutputOverride } from '@wundergraph/wgc-plugin-sdk';
import type { Failure, Output, PluginContext } from '@wundergraph/wgc-plugin-sdk';
import { config } from '../config.js';
import { createCliCredentials } from '../hub.js';
import { PluginEnvironment } from './environment.js';
import { knownPlugins, loadPlugin } from './plugin-package.js';
import { listInstalledPlugins, listWorkspacePlugins, resolvePlugin } from './registry.js';

export const createCliPluginContext = (): PluginContext =>
  createPluginContext({
    cliVersion: config.version,
    caller: detectCaller(process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
    endpoints: { cosmoApiUrl: config.baseURL, cosmoWebUrl: config.webURL, hubUrl: config.hubURL },
    credentials: createCliCredentials(),
    outputOverride: readOutputOverride(process.env),
  });

/** Claims the plugin's command name so `wgc <name> …` reports `failure` instead of commander's unknown-command error. */
const addFailingCommand = (
  program: Command,
  name: string,
  description: string,
  failure: Failure,
  output: () => Output,
): void => {
  program
    .command(name)
    .description(description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .argument('[args...]')
    .action(() => {
      output().fail(failure);
    });
};

const pluginsHelp = (environment: PluginEnvironment): string => {
  const names = [
    ...new Set([...listWorkspacePlugins(environment), ...listInstalledPlugins(environment)].map((p) => p.name)),
  ];
  const installed = names.length > 0 ? names.join(', ') : 'none';
  return `\nPlugins: ${installed}\nRun "wgc plugins list" to see available plugins and "wgc plugins install <name>" to add one.`;
};

/**
 * Registers the plugin the command line invokes, and only that one, so startup stays fast.
 * A known plugin that is not installed gets a command that prints how to install it.
 */
export const attachPlugins = async ({
  program,
  argv,
  environment,
  createContext,
}: {
  program: Command;
  argv: string[];
  environment: PluginEnvironment;
  createContext: () => PluginContext;
}): Promise<void> => {
  program.addHelpText('after', () => pluginsHelp(environment));
  const output = () => createContext().output({ json: argv.includes('--json') });

  const name = argv.slice(2).find((token) => !token.startsWith('-'));
  if (!name || program.commands.some((command) => command.name() === name || command.aliases().includes(name))) {
    return;
  }

  const resolved = resolvePlugin(environment, name);
  if (!resolved) {
    if (knownPlugins[name]) {
      addFailingCommand(
        program,
        name,
        `Provided by the ${name} plugin, which is not installed.`,
        {
          kind: 'usage',
          message: `The ${name} command comes from the ${name} plugin, which is not installed.`,
          remediation: `Install it with: wgc plugins install ${name}`,
          next: [`wgc plugins install ${name}`],
        },
        output,
      );
    }
    return;
  }

  const plugin = await loadPlugin(resolved.entryPath, name);
  if (!plugin.success) {
    addFailingCommand(
      program,
      name,
      `Provided by ${resolved.packageName}, which failed to load.`,
      { message: errorMessage(plugin), input: resolved.entryPath },
      output,
    );
    return;
  }

  const command = program.command(name).description(plugin.data.description);
  plugin.data.register(command, createContext());
};
