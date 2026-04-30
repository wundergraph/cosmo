import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import demoCommandFactory from './command.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('demo');
  command.description('Prepares demo federated graphs and facilitates onboarding');

  command.hook('preAction', async () => {
    await checkAuth();
  });

  command.action(demoCommandFactory(opts));

  return command;
};
