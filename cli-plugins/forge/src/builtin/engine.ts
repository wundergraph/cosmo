import { readFileSync } from 'node:fs';
import type { ForgeEngine } from '../engine.js';
import { registerAdd } from './commands/add.js';
import { registerBuild } from './commands/build.js';
import { registerCreate } from './commands/create.js';
import { registerInit } from './commands/init.js';
import { registerLock } from './commands/lock.js';
import { registerRouterUpgrade } from './commands/upgrade.js';
import type { System } from './system.js';

const packageVersion = (): string => {
  const packageJson: { version: string } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return packageJson.version;
};

/** Our implementation of the Forge v0.1 commands. Delete this directory once the Forge CLI ships. */
export const createBuiltinEngine = ({ system, cwd }: { system: System; cwd: () => string }): ForgeEngine => ({
  register(command, context) {
    command.version(packageVersion(), '--version', 'Print the Forge CLI version.');

    const dependencies = { system, context, cwd };
    registerInit(command, dependencies);
    registerCreate(command, dependencies);
    registerAdd(command, dependencies);
    registerLock(command, dependencies);
    registerBuild(command, dependencies);
    registerRouterUpgrade(command, dependencies);
  },
});
