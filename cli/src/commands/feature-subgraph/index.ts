import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureSubgraphCommand from './commands/create.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-subgraph').alias('fs');
  command.description('Provides commands for creating and managing a feature subgraphs.');

  command.addCommand(CreateFeatureSubgraphCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
