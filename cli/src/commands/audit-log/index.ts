import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import Stream from './commands/stream/index.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('audit-log');
  command.description('Provides commands for the organization audit log');
  command.addCommand(Stream(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
