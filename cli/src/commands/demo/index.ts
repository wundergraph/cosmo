import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateDemoStartCommand from './commands/start.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('demo');
  command.description('Prepares demo federated graphs and facilitates onboarding');

  command.addCommand(CreateDemoStartCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
