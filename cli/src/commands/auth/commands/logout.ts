import { rmSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { configDir } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import program from '../../index.js';

export default (opts: BaseCommandOptions) => {
  const logoutCommand = new Command('logout');
  logoutCommand.description('Logout a user.');

  logoutCommand.action(() => {
    try {
      rmSync(configDir, { recursive: true });
      console.log(pc.green('Logged out Successfully!'));
    } catch {
      program.error(pc.red(`No access token found. Please login with 'wgc auth login'`));
    }
  });

  return logoutCommand;
};
