import { Command } from 'commander';
import { checkAuth } from '../auth/utils.js';
import PushOperationsCommand from './commands/push.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('operations');
  command.description('Provides commands manipulating registered operations');
  command.addCommand(PushOperationsCommand(opts));

  command.hook('preAction', async (thisCmd) => {
    await checkAuth();
  });

  return command;
};
