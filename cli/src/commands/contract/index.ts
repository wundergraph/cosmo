import { Command } from 'commander';
import { checkAuth } from '../auth/utils.js';
import CreateContract from './commands/create.js';
import UpdateContract from './commands/update.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('contract');
  command.description('Provides commands for creating and updating contracts');

  command.addCommand(CreateContract(opts));
  command.addCommand(UpdateContract(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
