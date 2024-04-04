import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import PushOperationsCommand from './commands/push.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('operations');
  command.description('Provides commands manipulating registered operations');
  command.addCommand(PushOperationsCommand(opts));

  command.hook('preAction', async (thisCmd) => {
    await checkAuth();
  });

  return command;
};
