import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import CreateFeatureSubgraphCommand from './commands/create.js';
import PublishFeatureSubgraphCommand from './commands/publish.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('feature-subgraph').alias('fs');
  command.description(
    'A feature subgraph serves as an "override" of an existing subgraph. When composing for a feature flag that includes the feature subgraph, the feature subgraph replaces the base subgraph. This  provides commands for creating and managing feature subgraphs.',
  );

  command.addCommand(CreateFeatureSubgraphCommand(opts));
  command.addCommand(PublishFeatureSubgraphCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
