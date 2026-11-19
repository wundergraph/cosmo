import { definePlugin } from '@wundergraph/wgc-plugin-sdk';
import type { WgcPlugin } from '@wundergraph/wgc-plugin-sdk';
import { registerAdd } from './commands/add.js';
import { registerBuild } from './commands/build.js';
import { registerCreate } from './commands/create.js';
import { registerInit } from './commands/init.js';
import { registerLock } from './commands/lock.js';
import { registerRouterUpgrade } from './commands/upgrade.js';
import { createSystem } from './system.js';
import type { System } from './system.js';

/** Builds the plugin. Tests pass a `system` that stands in for Go, git and the user's test command. */
export const createForgePlugin = ({
  system = createSystem(),
  cwd = () => process.cwd(),
}: { system?: System; cwd?: () => string } = {}): WgcPlugin =>
  definePlugin({
    name: 'forge',
    description: 'Build and upgrade a Cosmo Router with custom modules',
    register(command, context) {
      const dependencies = { system, context, cwd };
      registerInit(command, dependencies);
      registerCreate(command, dependencies);
      registerAdd(command, dependencies);
      registerLock(command, dependencies);
      registerBuild(command, dependencies);
      registerRouterUpgrade(command, dependencies);
    },
  });

export default createForgePlugin();
