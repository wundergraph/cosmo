import { Command } from 'commander';
import { checkAPIKey } from '../../utils.js';
import { BaseCommandOptions } from '../../core/types/types.js';

import PushOperationsCommand from './commands/push';

export default (opts: BaseCommandOptions) => {
  const command = new Command('operations');
  command.description('Provides commands manipulating registered operations');
  command.addCommand(PushOperationsCommand(opts));

  command.hook('preAction', (thisCmd) => {
    checkAPIKey();
  });

  return command;
};
