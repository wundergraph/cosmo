import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import CreateContract from './commands/create.js';
import UpdateContract from './commands/update.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('contract');
  command.description('Provides commands for creating and updating contracts');

  command.addCommand(CreateContract(opts));
  command.addCommand(UpdateContract(opts));

  return command;
};
