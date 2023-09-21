import { existsSync, rmSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { configDir, configFile } from '../../../core/config.js';
import program from '../../index.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const logoutCommand = new Command('logout');
  logoutCommand.description('Logout a user.');

  logoutCommand.action(() => {
    if (!existsSync(configFile)) {
      program.error(pc.red(`No access token found. Please login with 'wgc auth login'`));
    }
    rmSync(configDir, { recursive: true });
    console.log(pc.green('Logged out Successfully!'));
  });

  return logoutCommand;
};
