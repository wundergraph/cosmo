import type { Command } from 'commander';
import { asGroup, withExamples } from '@wundergraph/wgc-plugin-sdk';
import type { PluginContext } from '@wundergraph/wgc-plugin-sdk';
import type { ForgeEngine } from '../engine.js';
import { registerAdd } from './commands/add.js';
import { registerBuild } from './commands/build.js';
import { registerCheck } from './commands/check.js';
import { registerCreate } from './commands/create.js';
import { registerInit } from './commands/init.js';
import { registerLock } from './commands/lock.js';
import { registerRouterUpgrade } from './commands/upgrade.js';
import { registerSource } from './commands/source.js';
import type { System } from './system.js';
import { forgeVersion } from './version.js';
import { registerCliUpgrade } from './commands/cli-upgrade.js';

/** Two real invocations per command, shown at the end of its help. */
const examples: Record<string, string[]> = {
  init: ['wgc forge init', 'wgc forge init my-router --release 0.299.0 --json'],
  create: ['wgc forge create --list-templates', 'wgc forge create request-id --preset request-id'],
  add: ['wgc forge add github.com/acme/mod/headers@v1.2.0', 'wgc forge add ./modules/auth --json'],
  lock: ['wgc forge lock', 'wgc forge lock --yes --json'],
  build: ['wgc forge build', 'wgc forge build --json'],
  check: ['wgc forge check', 'wgc forge check --json'],
  upgrade: ['wgc forge upgrade', 'wgc forge upgrade channel nightly'],
  'router upgrade': [
    'wgc forge router upgrade 0.300.0 --config router.yaml --check',
    'wgc forge router upgrade 0.300.0 --config router.yaml --yes --json',
  ],
  'source add': [
    'wgc forge source add ./openapi.yaml',
    'wgc forge source add https://api.example.com/openapi.json --name catalog',
  ],
};

/** Commands that only group subcommands. */
const groups = ['router', 'source'];

const findCommand = (root: Command, path: string): Command | undefined => {
  let current: Command | undefined = root;
  for (const name of path.split(' ')) {
    current = current?.commands.find((child) => child.name() === name);
  }
  return current;
};

const applyConventions = (root: Command, context: PluginContext): void => {
  for (const [path, invocations] of Object.entries(examples)) {
    const found = findCommand(root, path);
    if (found) {
      withExamples(found, invocations);
    }
  }
  for (const path of groups) {
    const found = findCommand(root, path);
    if (found) {
      asGroup(found, context, 'wgc forge');
    }
  }
};

/** Our implementation of the Forge v0.1 commands. Delete this directory once the Forge CLI ships. */
export const createBuiltinEngine = ({
  system,
  cwd,
  settingsFile,
}: {
  system: System;
  cwd: () => string;
  settingsFile: string;
}): ForgeEngine => ({
  register(command, context) {
    command.version(forgeVersion(), '--version', 'Print the Forge CLI version.');

    const dependencies = { system, context, cwd, settingsFile };
    registerInit(command, dependencies);
    registerCreate(command, dependencies);
    registerAdd(command, dependencies);
    registerLock(command, dependencies);
    registerBuild(command, dependencies);
    registerRouterUpgrade(command, dependencies);
    registerCliUpgrade(command, dependencies);
    registerCheck(command, dependencies);
    registerSource(command, dependencies);
    applyConventions(command, context);
  },
});
