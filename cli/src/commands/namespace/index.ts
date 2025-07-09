import { Command } from 'commander';
import { checkAuth } from '../auth/utils.js';
import Create from './commands/create.js';
import Delete from './commands/delete.js';
import List from './commands/list.js';
import Rename from './commands/rename.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('namespace');
  command.description('Provides commands for creating and maintaining namespaces');
  command.addCommand(Create(opts));
  command.addCommand(Rename(opts));
  command.addCommand(Delete(opts));
  command.addCommand(List(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
