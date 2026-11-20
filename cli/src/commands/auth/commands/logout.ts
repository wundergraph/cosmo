import { rmSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { configFile } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const logoutCommand = new Command('logout');
  logoutCommand.description('Logout a user from the Cosmo platform.');

  logoutCommand.action(() => {
    try {
      rmSync(configFile, { force: true });
    } catch {}
    console.log(pc.green('Logged out Successfully!'));
  });

  return logoutCommand;
};
