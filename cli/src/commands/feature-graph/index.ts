import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureFlagCommand from './commands/create.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-flag');
  command.description('Provides commands for creating and managing a feature flags');

  command.addCommand(CreateFeatureFlagCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
