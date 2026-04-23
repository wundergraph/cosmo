import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import ListClientsCommand from './commands/list.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('clients');
  command.description('Provides commands for managing clients');
  command.addCommand(ListClientsCommand(opts));

  command.hook('preAction', async (thisCmd) => {
    await checkAuth();
  });

  return command;
};
