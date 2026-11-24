import type { Command } from 'commander';
import {
  createPluginContext,
  detectCaller,
  errorMessage,
  hookableCommands,
  readOutputOverride,
} from '@wundergraph/wgc-plugin-sdk';
import type { Failure, HookableCommand, Output, PluginContext } from '@wundergraph/wgc-plugin-sdk';
import { commandName, config, homeDir } from '../config.js';
import { createCliCredentials } from '../hub.js';
import { PluginEnvironment } from './environment.js';
import { commandHooks, type CommandHookRegistry } from './hooks.js';
import { knownPlugins, loadPlugin } from './plugin-package.js';
import { listInstalledPlugins, listWorkspacePlugins, resolvePlugin } from './registry.js';

export const createCliPluginContext = (): PluginContext =>
  createPluginContext({
    cliVersion: config.version,
    command: commandName,
    homeDir,
    caller: detectCaller(process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
    endpoints: {
      cosmoApiUrl: config.baseURL,
      cosmoWebUrl: config.webURL,
      hubUrl: config.hubURL,
      hubAppUrl: config.hubAppURL,
      wgcInstallArgs: config.wgcInstallArgs,
    },
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
  return `\nPlugins: ${installed}\nRun "${commandName} plugins list" to see available plugins and "${commandName} plugins install <name>" to add one.`;
};

/** The hookable core command the command line runs, e.g. `subgraph check` for `wgc subgraph check …`. */
const hookedCommand = (program: Command, argv: string[]): HookableCommand | undefined => {
  const [name, subname] = argv.slice(2).filter((token) => !token.startsWith('-'));
  const matches = (command: Command, token: string | undefined) =>
    command.name() === token || command.aliases().includes(token ?? '');
  const parent = program.commands.find((command) => matches(command, name));
  const child = parent?.commands.find((command) => matches(command, subname));
  if (!parent || !child) {
    return undefined;
  }
  return hookableCommands.find((hookable) => hookable === `${parent.name()} ${child.name()}`);
};

/** Loads every plugin, workspace package first, and lets each register its hooks; one that fails to load is skipped with a warning. */
const attachHooks = async ({
  environment,
  createContext,
  hooks,
  warn,
}: {
  environment: PluginEnvironment;
  createContext: () => PluginContext;
  hooks: CommandHookRegistry;
  warn: (message: string) => void;
}): Promise<void> => {
  const names = new Set(
    [...listWorkspacePlugins(environment), ...listInstalledPlugins(environment)].map((p) => p.name),
  );
  for (const name of names) {
    const resolved = resolvePlugin(environment, name);
    if (!resolved) {
      continue;
    }
    const plugin = await loadPlugin(resolved.entryPath, name);
    if (!plugin.success) {
      warn(`The ${name} plugin did not load, so its hooks did not run: ${errorMessage(plugin)}`);
      continue;
    }
    const context = createContext();
    plugin.data.hooks?.(hooks.forPlugin(name, context), context);
  }
};

/**
 * Registers the plugin the command line invokes, and only that one, so startup stays fast. A known plugin that is
 * not installed gets a command that prints how to install it. A hookable core command such as `subgraph check` loads
 * every plugin instead, so each can hook it.
 */
export const attachPlugins = async ({
  program,
  argv,
  environment,
  createContext,
  hooks = commandHooks,
  warn = (message) => console.error(message),
}: {
  program: Command;
  argv: string[];
  environment: PluginEnvironment;
  createContext: () => PluginContext;
  hooks?: CommandHookRegistry;
  warn?: (message: string) => void;
}): Promise<void> => {
  program.addHelpText('after', () => pluginsHelp(environment));
  const output = () => createContext().output({ json: argv.includes('--json') });

  if (hookedCommand(program, argv)) {
    await attachHooks({ environment, createContext, hooks, warn });
    return;
  }

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
          remediation: `Install it with: ${commandName} plugins install ${name}`,
          next: [`${commandName} plugins install ${name}`],
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

  const { register, description } = plugin.data;
  if (!register) {
    return;
  }
  const command = program.command(name).description(description);
  register(command, createContext());
};
