import { rmSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { configDir } from '@/core/config.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const logoutCommand = new Command('logout');
  logoutCommand.description('Logout a user from the Cosmo platform.');

  logoutCommand.action(() => {
    try {
      rmSync(configDir, { recursive: true });
    } catch {}
    console.log(pc.green('Logged out Successfully!'));
  });

  return logoutCommand;
};
