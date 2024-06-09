import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureFlagCommand from './commands/create.js';
import EnableFeatureFlagCommand from './commands/enable.js';
import DisableFeatureFlagCommand from './commands/disable.js';
import UpdateFeatureFlagCommand from './commands/update.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-flag').alias('flags');
  command.description('Provides commands for creating and managing a feature flags.');

  command.addCommand(CreateFeatureFlagCommand(opts));
  command.addCommand(EnableFeatureFlagCommand(opts));
  command.addCommand(DisableFeatureFlagCommand(opts));
  command.addCommand(UpdateFeatureFlagCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
