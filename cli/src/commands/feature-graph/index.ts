import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureGraphCommand from './commands/create.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-graph').alias('fg');
  command.description('Provides commands for creating and managing a feature graphs');

  command.addCommand(CreateFeatureGraphCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
