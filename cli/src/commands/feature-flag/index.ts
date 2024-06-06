import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureFlagGroupCommand from './commands/create.js';
import EnableFeatureFlagGroupCommand from './commands/enable.js';
import DisableFeatureFlagGroupCommand from './commands/disable.js';
import UpdateFeatureFlagGroupCommand from './commands/update.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-flag-group');
  command.description('Provides commands for creating and managing a feature flag groups.');

  command.addCommand(CreateFeatureFlagGroupCommand(opts));
  command.addCommand(EnableFeatureFlagGroupCommand(opts));
  command.addCommand(DisableFeatureFlagGroupCommand(opts));
  command.addCommand(UpdateFeatureFlagGroupCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
