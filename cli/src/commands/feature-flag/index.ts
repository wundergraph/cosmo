import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureFlagCommand from './commands/create.js';
import DeleteFeatureFlagCommand from './commands/delete.js';
import EnableFeatureFlagCommand from './commands/enable.js';
import DisableFeatureFlagCommand from './commands/disable.js';
import UpdateFeatureFlagCommand from './commands/update.js';
import ListFeatureFlagCommand from './commands/list.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-flag').alias('ff');
  command.description('Provides commands for creating and managing feature flags.');

  command.addCommand(CreateFeatureFlagCommand(opts));
  command.addCommand(DeleteFeatureFlagCommand(opts));
  command.addCommand(EnableFeatureFlagCommand(opts));
  command.addCommand(DisableFeatureFlagCommand(opts));
  command.addCommand(UpdateFeatureFlagCommand(opts));
  command.addCommand(ListFeatureFlagCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
